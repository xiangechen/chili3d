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
    LENGTH_UNITS,
    MultistepCommand,
    type ParameterValue,
    PubSub,
    property,
    type ShapeMeshData,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { matchEdgeIndexes } from "../features/edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type { ChamferFeatureData, FilletFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
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
    protected abstract get value(): ParameterValue;
    protected abstract set value(value: ParameterValue);

    /**
     * The value as the preview, the arrow and the kernel need it. Undefined when the
     * expression will not resolve; the feature itself keeps what the user typed.
     */
    protected get valueNumber(): number | undefined {
        const resolved = this.resolveParameter(this.value, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

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
        const value = this.valueNumber;
        if (value === undefined || value <= 0) return;

        const picked = this.pickedEdgesOnBody();
        if (picked === undefined) return;
        const { node, edges } = picked;

        const meshes = this.buildPreviewMeshes(node, edges);
        if (meshes === undefined) return;

        this.previewOwner = edges[0].owner;
        this.document.visual.highlighter.addState(
            this.previewOwner,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        this.previewId = this.document.visual.context.displayMesh(meshes, { meshOpacity: 1 });
        this.document.visual.update();
    };

    /** The picked edges that all sit on one parametric body, plus that body. */
    private pickedEdgesOnBody(): { node: ParametricBodyNode; edges: VisualShapeData[] } | undefined {
        const selected = this.document.selection.getSelectedShapes();
        const node = selected.at(0)?.owner.node;
        if (!(node instanceof ParametricBodyNode) || !node.shape.isOk) return undefined;
        const edges = selected.filter((x) => x.owner.node === node && x.shape.shapeType === ShapeTypes.edge);
        if (edges.length === 0) return undefined;
        return { node, edges };
    }

    /** The corner result's mesh in the picked faces' world placement, or undefined on failure. */
    private buildPreviewMeshes(
        node: ParametricBodyNode,
        edges: VisualShapeData[],
    ): ShapeMeshData[] | undefined {
        const value = this.valueNumber;
        if (value === undefined) return undefined;
        const shape = node.shape.value;
        const indexes = matchEdgeIndexes(
            shape,
            edges.map((x) => captureEdgeRef(x.shape as unknown as IEdge)),
        );
        if (!indexes.isOk) return undefined;

        const result = shapeFactory[this.featureType](shape, indexes.value, value);
        if (!result.isOk) return undefined;
        const world = result.value.transformedMul(edges[0].transform);
        result.value.dispose();
        const { faces, edges: outlines } = world.mesh;
        world.dispose();
        if (faces === undefined) return undefined;
        return [faces, outlines].filter((x) => x !== undefined);
    }

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
        const value = this.valueNumber;
        if (value === undefined) return undefined;
        const first = this.document.selection.getSelectedShapes().at(0);
        if (first === undefined || !(first.owner.node instanceof ParametricBodyNode)) return undefined;

        const world = (first.shape as unknown as IEdge).transformedMul(first.transform) as IEdge;
        try {
            const midParam = (world.firstParameter() + world.lastParameter()) / 2;
            const direction = this.arrowDirection(world, midParam, first);
            if (direction === undefined) return undefined;
            return { anchor: world.pointAt(midParam), direction, value: Math.max(value, 0) };
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
        // The same refusal the extrude commit makes: the feature keeps the expression the user
        // typed, and an expression that no longer resolves — the variable was deleted between
        // typing and confirming, and the parameters panel is not modal — fails the next rebuild
        // and takes every feature after it down the chain with it.
        const resolved = this.resolveParameter(this.value, LENGTH_UNITS);
        if (!resolved.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", resolved.error);
            return;
        }
        const edges = this.stepDatas[0].shapes.map((data) => {
            const edgeId = this.body.edgeIdAt(data.indexes[0]);
            if (edgeId === undefined) {
                reportSilentIdLoss(this.body, "edge", "a picked fillet/chamfer edge has no tracked id");
            }
            return captureEdgeRef(data.shape as unknown as IEdge, edgeId, this.body.edgeIdIsShared(edgeId));
        });
        Transaction.execute(this.document, `excute ${this.featureType}`, () => {
            this.body.setFeaturesEmitShapeChanged([...this.body.features, this.feature(this.value, edges)]);
            this.document.visual.update();
        });
    }

    private feature(value: ParameterValue, edges: EdgeRef[]): FilletFeatureData | ChamferFeatureData {
        if (this.featureType === "fillet") {
            return { id: Id.generate(), type: "fillet", radius: value, edges };
        }
        return { id: Id.generate(), type: "chamfer", distance: value, edges };
    }
}

@command({ key: "feature.fillet", icon: "icon-fillet" })
export class FilletFeatureCommand extends EdgeCornerFeatureCommand {
    protected readonly featureType = "fillet" as const;

    @property("circle.radius", { unit: LENGTH_UNITS })
    get value(): ParameterValue {
        return this.getPrivateValue("value", 2);
    }
    set value(value: ParameterValue) {
        this.setProperty("value", value, () => this.updatePreview());
    }
}

@command({ key: "feature.chamfer", icon: "icon-chamfer" })
export class ChamferFeatureCommand extends EdgeCornerFeatureCommand {
    protected readonly featureType = "chamfer" as const;

    @property("common.length", { unit: LENGTH_UNITS })
    get value(): ParameterValue {
        return this.getPrivateValue("value", 1);
    }
    set value(value: ParameterValue) {
        this.setProperty("value", value, () => this.updatePreview());
    }
}
