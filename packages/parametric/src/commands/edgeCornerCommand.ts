// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CurveUtils,
    command,
    Id,
    type IEdge,
    type INode,
    type INodeVisual,
    type IStep,
    MultistepCommand,
    property,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { captureEdgeRef, type EdgeRef, matchEdgeIndexes } from "../features/edgeRef";
import type { ChamferFeatureData, FilletFeatureData } from "../features/feature";
import { ParametricBodyNode } from "../parametricBodyNode";
import {
    type EdgeCornerArrowData,
    type EdgeCornerPickHandler,
    EdgeCornerSelectStep,
} from "./edgeCornerPickStep";

/** Shared flow for fillet/chamfer: pick edges of a parametric body, enter the value. */
abstract class EdgeCornerFeatureCommand extends MultistepCommand {
    protected abstract readonly featureType: "fillet" | "chamfer";

    /** The fillet radius / chamfer distance, entered in the command's floating options tab. */
    protected abstract get value(): number;
    protected abstract set value(value: number);

    private get body(): ParametricBodyNode {
        return this.stepDatas[0].nodes![0] as unknown as ParametricBodyNode;
    }

    private previewId: number | undefined;
    private previewOwner: INodeVisual | undefined;
    private activeHandler: EdgeCornerPickHandler | undefined;

    protected override async executeAsync(): Promise<void> {
        const selection = this.document.selection;
        selection.onShapeChanged.sub(this.updatePreview);
        try {
            await super.executeAsync();
        } finally {
            selection.onShapeChanged.remove(this.updatePreview);
            this.removePreview();
        }
    }

    /**
     * Previews the fillet/chamfer on the body's current shape: the picked edges are
     * re-matched with the same fingerprint logic the feature evaluation uses, so the
     * preview equals the committed result. The original body is ghosted (faceTransparent)
     * while the preview is up — the rounded/chamfered surfaces are recessed into the
     * solid and an opaque original would hide them. Failures (an oversized value, an
     * ambiguous match) simply show no preview.
     */
    protected readonly updatePreview = () => {
        this.removePreview();
        this.activeHandler?.refreshArrow();
        if (!Number.isFinite(this.value) || this.value <= 0) return;

        const picked = this.document.selection.getSelectedShapes();
        const node = picked.at(0)?.owner.node;
        if (!(node instanceof ParametricBodyNode) || !node.shape.isOk) return;
        const edges = picked.filter((x) => x.owner.node === node && x.shape.shapeType === ShapeTypes.edge);
        if (edges.length === 0) return;

        const shape = node.shape.value;
        const indexes = matchEdgeIndexes(
            shape,
            edges.map((x) => captureEdgeRef(x.shape as unknown as IEdge)),
        );
        if (!indexes.isOk) return;

        const result = shapeFactory[this.featureType](shape, indexes.value, this.value);
        if (!result.isOk) return;
        const world = result.value.transformedMul(edges[0].transform);
        result.value.dispose();
        const { faces, edges: outlines } = world.mesh;
        world.dispose();
        if (faces === undefined) return;

        this.previewOwner = edges[0].owner;
        this.document.visual.highlighter.addState(
            this.previewOwner,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        this.previewId = this.document.visual.context.displayMesh(
            [faces, outlines].filter((x) => x !== undefined),
            { meshOpacity: 1 },
        );
        this.document.visual.update();
    };

    private removePreview() {
        if (this.previewOwner !== undefined) {
            this.document.visual.highlighter.removeState(
                this.previewOwner,
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );
            this.previewOwner = undefined;
        }
        if (this.previewId !== undefined) {
            this.document.visual.context.removeMesh(this.previewId);
            this.previewId = undefined;
        }
    }

    /**
     * Arrow placement for the drag handle: anchored at the first picked edge's midpoint,
     * pointing out of the body — radially for circular edges, otherwise along the
     * edge-midpoint-to-body-center direction projected perpendicular to the tangent.
     */
    private readonly arrowData = (): EdgeCornerArrowData | undefined => {
        if (!Number.isFinite(this.value)) return undefined;
        const first = this.document.selection.getSelectedShapes().at(0);
        if (first === undefined || !(first.owner.node instanceof ParametricBodyNode)) return undefined;

        const world = (first.shape as unknown as IEdge).transformedMul(first.transform) as IEdge;
        try {
            const midParam = (world.firstParameter() + world.lastParameter()) / 2;
            const direction = this.arrowDirection(world, midParam, first);
            if (direction === undefined) return undefined;
            return { anchor: world.pointAt(midParam), direction, value: Math.max(this.value, 0) };
        } finally {
            world.dispose();
        }
    };

    private arrowDirection(edge: IEdge, midParam: number, data: VisualShapeData): XYZ | undefined {
        const basis = edge.curve.basisCurve;
        if (CurveUtils.isCircle(basis)) {
            return edge.pointAt(midParam).sub(basis.center).normalize();
        }

        const tangent = edge.curve.d1(midParam).vec.normalize();
        const node = data.owner.node as ParametricBodyNode;
        if (tangent === undefined || !node.shape.isOk) return undefined;

        const center = data.transform.ofPoint(BoundingBox.center(node.shape.value.boundingBox()));
        const outward = edge.pointAt(midParam).sub(center);
        const perpendicular = outward.sub(tangent.multiply(outward.dot(tangent))).normalize();
        if (perpendicular !== undefined) return perpendicular;

        // Degenerate (the midpoint-to-center line runs along the edge): any perpendicular.
        const side = Math.abs(tangent.dot(XYZ.unitZ)) < 0.9 ? XYZ.unitZ : XYZ.unitX;
        return tangent.cross(side).normalize();
    }

    private readonly setValueFromArrow = (value: number) => {
        this.value = value;
    };

    protected override getSteps(): IStep[] {
        return [
            new EdgeCornerSelectStep(
                { allow: (node: INode) => this.allowNode(node) },
                { arrowData: this.arrowData, setValue: this.setValueFromArrow },
                (handler) => (this.activeHandler = handler),
            ),
        ];
    }

    /** Only parametric bodies; once an edge is picked, the rest must come from the same body. */
    private allowNode(node: INode): boolean {
        if (!(node instanceof ParametricBodyNode)) return false;
        const first = this.document.selection.getSelectedShapes().at(0)?.owner.node;
        return first === undefined || node === first;
    }

    protected override executeMainTask(): void {
        const edges = this.stepDatas[0].shapes.map((data) => {
            const edgeId = this.body.edgeIdAt(data.indexes[0]);
            return captureEdgeRef(data.shape as unknown as IEdge, edgeId, this.body.edgeIdIsShared(edgeId));
        });
        Transaction.execute(this.document, `excute ${this.featureType}`, () => {
            this.body.setFeaturesEmitShapeChanged([...this.body.features, this.feature(this.value, edges)]);
            this.document.visual.update();
        });
    }

    private feature(value: number, edges: EdgeRef[]): FilletFeatureData | ChamferFeatureData {
        if (this.featureType === "fillet") {
            return { id: Id.generate(), type: "fillet", radius: value, edges };
        }
        return { id: Id.generate(), type: "chamfer", distance: value, edges };
    }
}

@command({ key: "feature.fillet", icon: "icon-fillet" })
export class FilletFeatureCommand extends EdgeCornerFeatureCommand {
    protected readonly featureType = "fillet" as const;

    @property("circle.radius")
    get value() {
        return this.getPrivateValue("value", 2);
    }
    set value(value: number) {
        this.setProperty("value", value, () => this.updatePreview());
    }
}

@command({ key: "feature.chamfer", icon: "icon-chamfer" })
export class ChamferFeatureCommand extends EdgeCornerFeatureCommand {
    protected readonly featureType = "chamfer" as const;

    @property("common.length")
    get value() {
        return this.getPrivateValue("value", 1);
    }
    set value(value: number) {
        this.setProperty("value", value, () => this.updatePreview());
    }
}
