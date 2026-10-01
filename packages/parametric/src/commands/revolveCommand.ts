// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    BoundingBox,
    Combobox,
    CurveUtils,
    command,
    type I18nKeys,
    Id,
    type IEdge,
    type IFace,
    type ILine,
    type IShape,
    type IShapeFilter,
    type IStep,
    Line,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { captureEdgeRef } from "../features/edgeRef";
import type { BooleanOperation, RevolveFeatureData } from "../features/feature";
import { sketchProfiles } from "../features/profileBuilder";
import { captureProfileRef } from "../features/profileRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { SelectSketchProfilesStep } from "./extrudeCommand";
import { findIntersectingBody } from "./intersectingBody";

const OPERATION_NEW: I18nKeys = "option.command.operation.new";

/** Maps the command's operation dropdown values to boolean operations; new has none. */
const REVOLVE_OPERATIONS: Record<string, BooleanOperation> = {
    "option.command.operation.join": "fuse",
    "option.command.operation.cut": "cut",
    "option.command.operation.intersect": "common",
};

/**
 * Creates a revolve feature: pick sketch profiles (step 1), then the axis edge (step 2).
 * The committed body replays the feature through `shapeFactory.revolve`; the axis is a
 * live reference (fingerprinted in the axis node's local space) and the profiles are
 * sketch-space fingerprints, so editing either source rebuilds the revolve.
 *
 * Join/cut/intersect appends the feature to the auto-detected intersecting body
 * (Fusion-style, see the extrude command); "new" creates a standalone body.
 */
@command({ key: "feature.revolve", icon: "icon-revolve" })
export class RevolveFeatureCommand extends MultistepCommand {
    @property("option.command.operation", {
        combobox: Combobox.from([
            OPERATION_NEW,
            "option.command.operation.join",
            "option.command.operation.cut",
            "option.command.operation.intersect",
        ] satisfies I18nKeys[]),
    })
    get operation(): I18nKeys {
        return this.getPrivateValue("operation", OPERATION_NEW);
    }
    set operation(value: I18nKeys) {
        this.setProperty("operation", value);
    }

    @property("common.angle", { unit: ANGLE_UNITS })
    get angle(): ParameterValue {
        return this.getPrivateValue("angle", 360);
    }
    set angle(value: ParameterValue) {
        this.setProperty("angle", value);
    }

    private get sketch(): SketchNode {
        return this.stepDatas[0].nodes![0] as unknown as SketchNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectSketchProfilesStep((node) => node instanceof SketchNode),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.axis", {
                shapeFilter: new LineEdgeFilter(),
                keepSelection: true,
                highlightState: VisualStates.edgeHighlight,
                selectedState: VisualStates.edgeSelected,
            }),
        ];
    }

    private axis(): Line {
        const { shape, transform } = this.stepDatas[1].shapes[0];
        const curve = (shape as IEdge).curve.basisCurve as ILine;
        return new Line({
            point: transform.ofPoint(curve.value(0)),
            direction: transform.ofVector(curve.direction),
        });
    }

    protected override executeMainTask(): void {
        if (!this.validAngle()) return;
        const sketch = this.sketch;
        const feature = this.buildFeature();
        const operation = REVOLVE_OPERATIONS[this.operation];
        const target = operation === undefined ? undefined : this.findTargetBody();
        Transaction.execute(this.document, "excute feature.revolve", () => {
            if (operation !== undefined && target !== undefined) {
                target.setFeaturesEmitShapeChanged([...target.features, { ...feature, operation }]);
            } else {
                this.document.modelManager.addNode(
                    new ParametricBodyNode({ document: this.document, features: [feature] }),
                );
            }
            // The sketch is consumed by the feature; hide it. Same transaction, so
            // undo restores the visibility together with the body.
            sketch.visible = false;
            this.document.visual.update();
        });
    }

    /**
     * The join/cut/intersect target: the revolved tool's box is measured first to give the
     * shared detection its bounds (see `findIntersectingBody`). Undefined when the tool
     * cannot be built at all, which leaves the feature standalone.
     */
    private findTargetBody(): ParametricBodyNode | undefined {
        const box = this.toolBox();
        return box === undefined ? undefined : findIntersectingBody(this.document, box);
    }

    /**
     * The revolved tool's world bounding box — the interference probe only. The feature
     * rebuilds the same geometry from the stored refs, so this runs the kernel once per
     * profile at commit time and disposes every probe shape.
     */
    private toolBox(): BoundingBox | undefined {
        const angle = this.resolveParameter(this.angle, ANGLE_UNITS);
        if (!angle.isOk || angle.value === 0) return undefined;
        const faces = this.profileFaces();
        if (faces.length === 0) return undefined;
        const axis = this.axis();
        let box: BoundingBox | undefined;
        for (const face of faces) {
            const revolved = shapeFactory.revolve(face, axis, angle.value);
            if (!revolved.isOk) return box;
            try {
                box = BoundingBox.combine(box, revolved.value.boundingBox());
            } finally {
                revolved.value.dispose();
            }
        }
        return box;
    }

    /** The picked profile faces (sketch space), or the whole sketch's outer profiles when none were picked. */
    private profileFaces(): IFace[] {
        const picked = this.stepDatas[0].shapes.map((x) => x.shape as unknown as IFace);
        if (picked.length > 0) return picked;
        const profiles = sketchProfiles(this.sketch);
        return profiles.isOk ? profiles.value.outer : [];
    }

    private validAngle(): boolean {
        // The feature keeps the expression; what has to be a usable angle is what it
        // resolves to.
        const angle = this.resolveParameter(this.angle, ANGLE_UNITS);
        if (angle.isOk && angle.value !== 0) return true;
        PubSub.default.pub("showToast", "error.input.invalidNumber");
        return false;
    }

    private buildFeature(): RevolveFeatureData {
        const axis = this.axis();
        // Picked profile faces are fingerprinted (undefined revolves the whole sketch).
        const faces = this.stepDatas[0].shapes.map((x) => x.shape as unknown as IFace);
        return {
            id: Id.generate(),
            type: "revolve",
            sketchId: this.sketch.id,
            axis: {
                point: { x: axis.point.x, y: axis.point.y, z: axis.point.z },
                direction: { x: axis.direction.x, y: axis.direction.y, z: axis.direction.z },
            },
            angle: this.angle,
            ...(faces.length > 0 ? { profiles: faces.map((face) => captureProfileRef(face)) } : {}),
            ...this.axisSource(),
        };
    }

    /**
     * The axis as a fingerprinted edge reference (local coords), so it follows the
     * source node on rebuild; the `axis` snapshot stays as the fallback.
     */
    private axisSource(): Pick<RevolveFeatureData, "axisSource"> {
        const data = this.stepDatas[1].shapes[0];
        const node = data.owner.node;
        if (!(node instanceof ShapeNode)) return {};
        return {
            axisSource: { nodeId: node.id, edge: captureEdgeRef(data.shape as unknown as IEdge) },
        };
    }
}

class LineEdgeFilter implements IShapeFilter {
    allow(shape: IShape): boolean {
        if (shape.shapeType !== ShapeTypes.edge) return false;
        return CurveUtils.isLine((shape as IEdge).curve.basisCurve);
    }
}
