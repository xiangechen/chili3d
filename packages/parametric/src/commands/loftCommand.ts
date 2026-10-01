// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    Combobox,
    Continuities,
    type Continuity,
    command,
    type I18nKeys,
    Id,
    type IEdge,
    type IFace,
    type IShape,
    type IVertex,
    type IWire,
    Matrix4,
    PubSub,
    property,
    Result,
    type ShapeMeshData,
    ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
    VisualConfig,
    type VisualShapeData,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef } from "../features/edgeRef";
import type { BooleanOperation, LoftFeatureData, LoftSectionData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { validateLoftSections } from "../features/loft";
import { captureProfileRef } from "../features/profileRef";
import { captureVertexRef } from "../features/vertexRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { findIntersectingBody } from "./intersectingBody";

const OPERATION_NEW: I18nKeys = "option.command.operation.new";

/** Maps the command's operation dropdown values to boolean operations; new has none. */
const LOFT_OPERATIONS: Record<string, BooleanOperation> = {
    "option.command.operation.join": "fuse",
    "option.command.operation.cut": "cut",
    "option.command.operation.intersect": "common",
};

/**
 * Creates a loft feature: pick sections in order (sketch profiles, solid faces, closed
 * edges, or a vertex for a pointed end), confirm builds a parametric body replaying
 * them through `loftTracked`. The pick loop and live preview mirror the direct
 * modeler's `create.loft`; the committed body is a `ParametricBodyNode` whose feature
 * re-matches every section against its node's rebuilt shape.
 *
 * A solid loft's join/cut/intersect appends the feature to the auto-detected
 * intersecting body (Fusion-style, see the extrude command); "new" creates a standalone
 * body. A shell drops the operation — it has no volume to combine with.
 */
@command({ key: "feature.loft", icon: "icon-loft" })
export class LoftFeatureCommand extends CancelableCommand {
    private visual: number | undefined;
    private readonly sections: LoftSectionData[] = [];
    /** World-space shapes of the picked sections, for the preview loft. */
    private readonly sectionShapes: (IWire | IEdge | IVertex)[] = [];
    /** Transformed copies made for the preview, disposed with the visual. */
    private readonly owned: IShape[] = [];

    @property("option.command.isSolid")
    get isSolid() {
        return this.getPrivateValue("isSolid", true);
    }
    set isSolid(value: boolean) {
        this.setProperty("isSolid", value, () => this.displayVisual());
    }

    /**
     * A shell has no volume to combine with, so the dropdown only shows while the loft is
     * a solid (the same rule the feature applies when replaying — see `loft.ts`).
     */
    @property("option.command.operation", {
        dependencies: [{ property: "isSolid", value: true }],
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

    @property("option.command.isRuled")
    get isRuled() {
        return this.getPrivateValue("isRuled", false);
    }
    set isRuled(value: boolean) {
        this.setProperty("isRuled", value, () => this.displayVisual());
    }

    @property("option.command.continuity", {
        dependencies: [
            {
                property: "isRuled",
                value: false,
            },
        ],
        combobox: Combobox.from([...Continuities]),
    })
    get continuity(): Continuity {
        return this.getPrivateValue("continuity", "c2");
    }
    set continuity(value: Continuity) {
        this.setProperty("continuity", value, () => this.displayVisual());
    }

    @property("common.confirm")
    readonly confirm = () => {
        this.controller?.success();
    };

    protected override async executeAsync(): Promise<void> {
        try {
            while (true) {
                this.controller = new AsyncController();
                const picked = await this.pickSection();
                if (picked === undefined) {
                    if (this.controller.result?.status === "success") break;
                    return;
                }
                if (this.acceptSection(picked)) this.displayVisual();
            }
            this.commitLoft();
        } finally {
            this.clearVisual();
        }
    }

    private async pickSection(): Promise<VisualShapeData | undefined> {
        this.document.selection.clearSelection();
        const shapes = await this.document.picker.pickShape("prompt.select.section", this.controller!, {
            shapeType: (ShapeTypes.face | ShapeTypes.edge | ShapeTypes.vertex) as ShapeType,
            multi: false,
            nodeFilter: { allow: (node) => node instanceof ShapeNode },
        });
        return shapes[0];
    }

    private acceptSection(data: VisualShapeData): boolean {
        if (this.sections.at(-1)?.kind === "vertex") {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "Loft vertex sections must be first or last",
            );
            return false;
        }
        if (this.isDuplicate(data)) return false;
        const section = this.buildSection(data);
        if (!section.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", section.error);
            return false;
        }
        this.sections.push(section.value.section);
        this.sectionShapes.push(section.value.shape);
        return true;
    }

    /** Same node and same picked sub-shape (a vertex: same point) — picking twice adds nothing. */
    private isDuplicate(data: VisualShapeData): boolean {
        const nodeId = (data.owner.node as ShapeNode).id;
        return this.sections.some((section, index) => {
            if (section.nodeId !== nodeId) return false;
            const picked = this.sectionShapes[index];
            if (picked.shapeType !== data.shape.shapeType) return false;
            return picked.shapeType === ShapeTypes.vertex
                ? (picked as IVertex).point().isEqualTo((data.shape as IVertex).point())
                : picked.isEqual(data.shape);
        });
    }

    /** The stored section plus its world-space preview shape. */
    private buildSection(
        data: VisualShapeData,
    ): Result<{ section: LoftSectionData; shape: IWire | IEdge | IVertex }> {
        switch (data.shape.shapeType) {
            case ShapeTypes.face:
                return this.faceSection(data);
            case ShapeTypes.edge:
                return this.edgeSection(data);
            case ShapeTypes.vertex:
                return Result.ok({
                    section: {
                        kind: "vertex",
                        nodeId: (data.owner.node as ShapeNode).id,
                        vertex: captureVertexRef(data.shape as IVertex),
                    },
                    shape: this.worldShape(data) as IVertex,
                });
            default:
                return Result.err("Unsupported loft section");
        }
    }

    /** Sketch profiles fingerprint the RAW face (sketch space); solid faces the WORLD one (the press-pull contract). */
    private faceSection(
        data: VisualShapeData,
    ): Result<{ section: LoftSectionData; shape: IWire | IEdge | IVertex }> {
        const node = data.owner.node as ShapeNode;
        if (node instanceof SketchNode) {
            const face = data.shape as unknown as IFace;
            return Result.ok({
                section: { kind: "profile", nodeId: node.id, profile: captureProfileRef(face) },
                shape: this.worldFace(data).outerWire(),
            });
        }
        const face = this.worldFace(data);
        const tracked = isBodyTrackingNode(node) ? node : undefined;
        const faceId = tracked?.faceIdAt(data.indexes[0]);
        if (faceId === undefined && tracked !== undefined) {
            reportSilentIdLoss(tracked, "face", "a loft section face has no tracked id");
        }
        const splitPiece = node instanceof ParametricBodyNode ? node.faceIdIsShared(faceId) : undefined;
        return Result.ok({
            section: {
                kind: "profile",
                nodeId: node.id,
                profile: captureProfileRef(face, faceId, splitPiece, true),
            },
            shape: face.outerWire(),
        });
    }

    /** The edge ref fingerprints the LOCAL shape (it re-matches on the node's own shape); the preview gets the world copy. */
    private edgeSection(
        data: VisualShapeData,
    ): Result<{ section: LoftSectionData; shape: IWire | IEdge | IVertex }> {
        const node = data.owner.node as ShapeNode;
        const edge = data.shape as unknown as IEdge;
        if (!edge.isClosed()) return Result.err("A loft section edge must be closed");
        const tracked = isBodyTrackingNode(node) ? node : undefined;
        const edgeId = tracked?.edgeIdAt(data.indexes[0]);
        const splitPiece = node instanceof ParametricBodyNode ? node.edgeIdIsShared(edgeId) : undefined;
        return Result.ok({
            section: { kind: "edge", nodeId: node.id, edge: captureEdgeRef(edge, edgeId, splitPiece) },
            shape: this.worldShape(data) as IEdge,
        });
    }

    /** The picked face in world coordinates; transformed copies are owned by the command. */
    private worldFace(data: VisualShapeData): IFace {
        return this.worldShape(data) as IFace;
    }

    private worldShape(data: VisualShapeData): IShape {
        if (data.transform.equals(Matrix4.identity())) return data.shape;
        const world = data.shape.transformedMul(data.transform);
        this.owned.push(world);
        return world;
    }

    private displayVisual(): void {
        this.removeVisual();
        const meshes: ShapeMeshData[] = this.sectionShapes.map((x) => {
            const mesh = x.mesh.edges!;
            mesh.color = VisualConfig.selectedEdgeColor;
            mesh.lineWidth = 3;
            return mesh;
        });
        if (this.sectionShapes.length > 1) {
            const preview = shapeFactory.loft(
                this.sectionShapes,
                this.isSolid,
                this.isRuled,
                this.continuity,
            );
            if (preview.isOk) {
                const faces = preview.value.mesh.faces;
                if (faces !== undefined) meshes.push(faces);
                preview.value.dispose();
            } else {
                PubSub.default.pub("showToast", "error.default:{0}", preview.error);
            }
        }
        this.visual = this.document.visual.context.displayMesh(meshes, { meshOpacity: 0.5 });
        this.document.visual.update();
    }

    private clearVisual(): void {
        this.removeVisual();
        this.owned.forEach((x) => x.dispose());
        this.document.visual.highlighter.clear();
        this.document.visual.update();
    }

    private readonly removeVisual = () => {
        if (this.visual !== undefined) {
            this.document.visual.context.removeMesh(this.visual);
            this.visual = undefined;
        }
    };

    private commitLoft(): void {
        const valid = validateLoftSections(this.sections);
        if (!valid.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", valid.error);
            return;
        }
        const feature: LoftFeatureData = {
            id: Id.generate(),
            type: "loft",
            sections: [...this.sections],
            isSolid: this.isSolid,
            isRuled: this.isRuled,
            continuity: this.continuity,
        };
        // A shell has no volume to combine with, so the operation is dropped here rather
        // than stored and ignored (the dropdown is hidden in that state anyway).
        const operation = this.isSolid ? LOFT_OPERATIONS[this.operation] : undefined;
        const target = operation === undefined ? undefined : this.findTargetBody();
        Transaction.execute(this.document, "execute feature.loft", () => {
            if (operation !== undefined && target !== undefined) {
                target.setFeaturesEmitShapeChanged([...target.features, { ...feature, operation }]);
            } else {
                this.document.modelManager.addNode(
                    new ParametricBodyNode({ document: this.document, features: [feature] }),
                );
            }
            // Consumed sketches are hidden in the same transaction, so undo restores
            // the visibility together with the body (the extrude convention).
            for (const nodeId of new Set(this.sections.map((x) => x.nodeId))) {
                const node = this.document.modelManager.findNode((n) => n.id === nodeId);
                if (node instanceof SketchNode) node.visible = false;
            }
            this.document.visual.update();
        });
    }

    /**
     * The join/cut/intersect target: the preview loft gives the shared detection its
     * bounds (see `findIntersectingBody`). Undefined when the preview cannot be built,
     * which leaves the feature standalone.
     */
    private findTargetBody(): ParametricBodyNode | undefined {
        if (this.sectionShapes.length < 2) return undefined;
        const preview = shapeFactory.loft(this.sectionShapes, this.isSolid, this.isRuled, this.continuity);
        if (!preview.isOk) return undefined;
        try {
            return findIntersectingBody(this.document, preview.value.boundingBox());
        } finally {
            preview.value.dispose();
        }
    }
}
