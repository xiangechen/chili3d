// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    command,
    Id,
    type IEdge,
    type IFace,
    type ILine,
    type INode,
    type IShape,
    type IShapeFilter,
    type IStep,
    Line,
    MultistepCommand,
    PubSub,
    property,
    SelectShapeStep,
    ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { captureEdgeRef } from "../features/edgeRef";
import type { RevolveFeatureData } from "../features/feature";
import { captureProfileRef } from "../features/profileRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { SelectSketchProfilesStep } from "./extrudeCommand";

@command({ key: "feature.revolve", icon: "icon-revolve" })
export class RevolveFeatureCommand extends MultistepCommand {
    @property("common.angle")
    get angle() {
        return this.getPrivateValue("angle", 360);
    }
    set angle(value: number) {
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
        const node = new ParametricBodyNode({
            document: this.document,
            features: [this.buildFeature()],
        });
        Transaction.execute(this.document, "excute feature.revolve", () => {
            this.document.modelManager.addNode(node);
            // The sketch is consumed by the feature; hide it. Same transaction, so
            // undo restores the visibility together with the body.
            sketch.visible = false;
            this.document.visual.update();
        });
    }

    private validAngle(): boolean {
        if (Number.isFinite(this.angle) && this.angle !== 0) return true;
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
