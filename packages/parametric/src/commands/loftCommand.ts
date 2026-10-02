// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    AUTO_TARGETS,
    type BoundingBox,
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
    type TargetCandidate,
    type TargetSelection,
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
import { buildTargetPreview } from "./booleanPreview";
import {
    candidateBodies,
    commitBooleanTargets,
    resolveTargetBodies,
    standaloneBody,
    syncAutoTargets,
    targetCandidate,
} from "./booleanTargets";
import { PreviewVisual } from "./previewVisual";

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
    private readonly preview = new PreviewVisual();
    private readonly sections: LoftSectionData[] = [];
    /** World-space shapes of the picked sections, for the preview loft. */
    private readonly sectionShapes: (IWire | IEdge | IVertex)[] = [];
    /**
     * The sub-shape each section was picked from, parallel to `sections` and in the node's
     * own coordinates — what `isDuplicate` compares. `sectionShapes` cannot serve that: it
     * holds a face's outer wire, and the preview loft rewrites bare edges into wires, so it
     * never matches a fresh pick.
     */
    private readonly pickedShapes: (IFace | IEdge | IVertex)[] = [];
    /** Transformed copies made for the preview, disposed with the visual. */
    private readonly owned: IShape[] = [];

    /**
     * Which bodies the join/cut/intersect combines with. The set is the command's, and the
     * detection refills it after every section while it is still on auto — see
     * `applyAutoTargets`.
     */
    @property("option.command.targets", {
        type: "targets",
        dependencies: [{ property: "showTargets", value: true }],
    })
    get targets(): TargetSelection {
        return this.getPrivateValue("targets", AUTO_TARGETS);
    }
    set targets(value: TargetSelection) {
        this.setProperty("targets", value);
    }

    /** The list needs a solid and an operation: a shell has no volume to combine with. */
    get showTargets(): boolean {
        return this.getPrivateValue("showTargets", this.isSolid && this.operation !== OPERATION_NEW);
    }
    set showTargets(value: boolean) {
        this.setProperty("showTargets", value);
    }

    targetCandidates(): readonly TargetCandidate[] {
        return candidateBodies(this.document).map(targetCandidate);
    }

    setTargets(selection: TargetSelection): void {
        this.targets = selection;
        this.displayVisual();
    }

    /**
     * The detection's write path. It goes around the setter because the write is a
     * consequence of the preview it happens inside, not a request for another one — but the
     * property event still goes out, and that is what redraws the checkbox list.
     */
    private applyAutoTargets(selection: TargetSelection): void {
        const previous = this.targets;
        this.setPrivateValue("targets", selection);
        this.emitPropertyChanged("targets", previous);
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        // The panel is up by now (the base publishes it) and its list is subscribed, so this
        // both starts the run on auto-detection and repaints the boxes. The option cache keys
        // on the property name alone, so a set left over from an earlier run must not decide
        // this one.
        this.targets = AUTO_TARGETS;
    }

    @property("option.command.isSolid")
    get isSolid() {
        return this.getPrivateValue("isSolid", true);
    }
    set isSolid(value: boolean) {
        this.setProperty("isSolid", value, () => this.displayVisual());
        this.showTargets = value && this.operation !== OPERATION_NEW;
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
        this.showTargets = this.isSolid && value !== OPERATION_NEW;
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

    /**
     * The pick loop: a click accepts a section, and the viewport bar's confirm (up for
     * every pick — see `pickSection`) ends the list. A click already completes a
     * `multi: false` pick, so the next pick starts with nothing selected and the bar's
     * confirm resolves it with no shapes — which is exactly the "done" signal.
     */
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
            // A click accepts a section; the bar's confirm is what ends the section list,
            // so it has to be up even though this pick finishes on click (`multi: false`).
            showConfirmControl: true,
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
        this.pickedShapes.push(data.shape as IFace | IEdge | IVertex);
        return true;
    }

    /** Same node and same picked sub-shape (a vertex: same point) — picking twice adds nothing. */
    private isDuplicate(data: VisualShapeData): boolean {
        const nodeId = (data.owner.node as ShapeNode).id;
        const picked = data.shape as IFace | IEdge | IVertex;
        return this.sections.some((section, index) => {
            const previous = this.pickedShapes[index];
            if (section.nodeId !== nodeId || previous.shapeType !== picked.shapeType) return false;
            return previous.shapeType === ShapeTypes.vertex
                ? (previous as IVertex).point().isEqualTo((picked as IVertex).point())
                : previous.isEqual(picked);
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
        const meshes: ShapeMeshData[] = this.sectionShapes.map((x) => {
            const mesh = x.mesh.edges!;
            mesh.color = VisualConfig.selectedEdgeColor;
            mesh.lineWidth = 3;
            return mesh;
        });
        const hidden: ParametricBodyNode[] = [];
        if (this.sectionShapes.length > 1) {
            const preview = this.loftShape();
            if (!preview.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", preview.error);
            } else {
                try {
                    const operated = this.previewOperation(preview.value);
                    meshes.push(...operated.meshes);
                    hidden.push(...operated.hidden);
                } finally {
                    preview.value.dispose();
                }
            }
        }
        this.preview.show(this.document, meshes, hidden);
    }

    private loftShape(): Result<IShape> {
        return shapeFactory.loft(this.sectionShapes, this.isSolid, this.isRuled, this.continuity);
    }

    /**
     * The loft's own mesh, or — when an operation is set and bodies are in the way — what that
     * operation makes of each of them, standing in for the bodies it rewrites. The targets are
     * the ones the commit appends the feature to, so the preview and the committed bodies
     * agree on what is being modified. A shell has no volume to combine with, so it keeps its
     * own mesh (the operation is dropped at commit for the same reason).
     */
    private previewOperation(loft: IShape): { meshes: ShapeMeshData[]; hidden: ParametricBodyNode[] } {
        const operation = this.isSolid ? LOFT_OPERATIONS[this.operation] : undefined;
        if (operation === undefined) return { meshes: this.loftMeshes(loft), hidden: [] };

        const targets = this.resolveTargets(loft.boundingBox());
        if (targets.length === 0) return { meshes: this.loftMeshes(loft), hidden: [] };
        return buildTargetPreview(operation, loft, targets);
    }

    private loftMeshes(loft: IShape): ShapeMeshData[] {
        const faces = loft.mesh.faces;
        return faces === undefined ? [] : [faces];
    }

    private clearVisual(): void {
        this.preview.hide(this.document);
        this.owned.forEach((x) => x.dispose());
        this.document.visual.highlighter.clear();
        this.document.visual.update();
    }

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
        const targets = operation === undefined ? [] : this.resolveTargets(this.toolBox());
        Transaction.execute(this.document, "execute feature.loft", () => {
            if (operation === undefined) standaloneBody(this.document, feature);
            else commitBooleanTargets(this.document, feature, operation, targets);
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
     * The loft's box, built only to be measured: the detection needs the tool's bounds, and a
     * loft that cannot be built at all leaves the feature standing on its own.
     */
    private toolBox(): BoundingBox | undefined {
        if (this.sectionShapes.length < 2) return undefined;
        const preview = this.loftShape();
        if (!preview.isOk) return undefined;
        try {
            return preview.value.boundingBox();
        } finally {
            preview.value.dispose();
        }
    }

    /** The bodies this run combines with, refreshing the auto set from the loft's box first. */
    private resolveTargets(box: BoundingBox | undefined): ParametricBodyNode[] {
        if (box !== undefined) {
            syncAutoTargets(this.document, box, this.targets, (next) => this.applyAutoTargets(next));
        }
        return resolveTargetBodies(this.document, box, this.targets);
    }
}
