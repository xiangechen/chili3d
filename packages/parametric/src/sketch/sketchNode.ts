// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type INode,
    type IShape,
    type IShapeMeshData,
    isPropertyChanged,
    Matrix4,
    MultiShapeMesh,
    ParameterShapeNode,
    type Plane,
    Precision,
    PubSub,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";
import { isBodyTimelineNode } from "../features/bodyTracking";
import { allProfiles, sketchProfiles } from "../features/profileBuilder";
import { syncNodeWatches } from "../nodeWatch";
import { resolveExternalRefs } from "./externalRef";
import { type PlaneFaceRef, resolveFacePlane } from "./planeRef";
import {
    arcAngles,
    type ExternalRefData,
    profileExternalRefs,
    rawArcSweep,
    SKETCH_EDGE_LINE_WIDTH,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    toWorld,
} from "./sketchModel";
import { normalizeSnapshot, SketchSolver } from "./solver";

export interface SketchNodeOptions {
    document: IDocument;
    plane: Plane;
    /** Present when the plane was captured from a solid's face; the sketch follows that face. */
    planeRef?: PlaneFaceRef;
    /** Serialized form produced by the Serializer; takes precedence over `planeRef`. */
    planeRefJson?: string;
    data?: SketchData;
    /** Serialized form produced by the Serializer; takes precedence over `data`. */
    dataJson?: string;
    id?: string;
}

@serializable()
export class SketchNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sketch";
    }

    @serialize()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }
    /** Undo/redo assigns through the property (PropertyHistoryRecord), so a setter is required. */
    set plane(value: Plane) {
        this.setPropertyEmitShapeChanged("plane", value);
    }

    /**
     * PlaneFaceRef is a plain JSON object graph; the Serializer only round-trips
     * @serializable classes, so it is stored as a JSON string like dataJson.
     */
    @serialize()
    get planeRefJson(): string | undefined {
        return this.getPrivateValue("planeRefJson");
    }

    get planeRef(): PlaneFaceRef | undefined {
        const json = this.planeRefJson;
        return json === undefined ? undefined : (JSON.parse(json) as PlaneFaceRef);
    }

    /**
     * SketchData is a plain JSON object graph; the Serializer only round-trips
     * @serializable classes, so it is stored as a JSON string.
     */
    @serialize()
    get dataJson(): string {
        return this.getPrivateValue("dataJson");
    }
    /** Undo/redo assigns through the property (PropertyHistoryRecord), so a setter is required. */
    set dataJson(value: string) {
        this.setPropertyEmitShapeChanged("dataJson", value);
    }

    /**
     * Freshly parsed on EVERY call — that is a contract, not waste: refreshExternalRefs
     * and resolveExternalRefs mutate the returned refs in place and persist them back
     * only later (or never, when a path bails midway). Do not memoize the parse; a
     * shared object would leak such uncommitted mutations into every other reader.
     */
    get data(): SketchData {
        return JSON.parse(this.dataJson) as SketchData;
    }

    private _planeRefNode: INode | undefined;

    /**
     * Derived, runtime-only warning state behind `INodeWarning` (the model-tree
     * badge) and the one-shot loss toast. Both are keyed off the dangling
     * profile-role refs after each resolution pass; the constructor seeds them from
     * the restored data so opening a document with already-dangling refs badges the
     * row immediately without replaying the "lost their source" toast — the loss is
     * not news, it was saved that way.
     */
    private _danglingProfileCount: number;
    private _danglingSignature: string;

    /** INodeWarning: dangling profile-role external references badge the model-tree row. */
    get warningCount(): number {
        return this._danglingProfileCount;
    }

    /** INodeWarning: badge tooltip (and loss toast) — `{0}` takes `warningCount`. */
    get warningTooltip(): I18nKeys {
        return "sketch.externalRefsLost{0}";
    }

    constructor(options: SketchNodeOptions) {
        super({ document: options.document, id: options.id });
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue(
            "planeRefJson",
            options.planeRefJson ??
                (options.planeRef === undefined ? undefined : JSON.stringify(options.planeRef)),
        );
        this.setPrivateValue(
            "dataJson",
            options.dataJson ?? JSON.stringify(options.data ?? { entities: [], constraints: [] }),
        );
        const danglingIds = danglingProfileRefIds(this.data.externalRefs ?? []);
        this._danglingProfileCount = danglingIds.length;
        this._danglingSignature = danglingIds.join(",");
    }

    setDataEmitShapeChanged(data: SketchData): void {
        this.setPropertyEmitShapeChanged("dataJson", JSON.stringify(data));
    }

    private _showProfileFaces = true;

    /**
     * Whether the mesh includes the closed profile faces so they can be hovered and
     * picked in the viewport (e.g. extrude profile selection). On outside sketch
     * editing; `SketchEditor` turns it off for the session so the faces don't get in
     * the way of editing geometry. Not serialized.
     */
    get showProfileFaces(): boolean {
        return this._showProfileFaces;
    }

    setShowProfileFaces(value: boolean): void {
        if (this._showProfileFaces === value) return;
        this._showProfileFaces = value;
        this._mesh = undefined;
        // The visual rebuilds its meshes on "shape" changes; the shape itself is untouched.
        this.emitPropertyChanged("shape", this._shape);
    }

    protected override createMesh(): IShapeMeshData {
        const mesh = this.sketchMesh();
        if (mesh.edges !== undefined) mesh.edges.lineWidth = SKETCH_EDGE_LINE_WIDTH;
        return mesh;
    }

    private sketchMesh(): IShapeMeshData {
        if (!this._showProfileFaces || !this.shape.isOk) return super.createMesh();
        const profiles = sketchProfiles(this);
        // Outer profiles come with holes applied; inner loops are shown as solid faces
        // so the hole region stays clickable (it selects the inner profile).
        const faces = profiles.isOk ? allProfiles(profiles.value) : [];
        if (faces.length === 0) return super.createMesh();
        const mesh = new MultiShapeMesh();
        mesh.addShape(this.shape.value, Matrix4.identity());
        for (const face of faces) {
            mesh.addShape(face, Matrix4.identity());
        }
        return mesh;
    }

    generateShape(): Result<IShape> {
        // Take-and-clear FIRST: the flag belongs to this one evaluation — a throw
        // further down must not leak it into the next evaluation, which would then
        // wrongly skip refreshExternalRefs.
        const refsFresh = this._externalRefsFresh;
        this._externalRefsFresh = false;
        this.syncPlaneRefWatch();
        if (!refsFresh) {
            this.refreshExternalRefs();
        }
        // Read AFTER refreshExternalRefs (which persists re-resolved refs untransacted)
        // and shared by both consumers below — one parse per evaluation. The watch
        // sync stays unconditional like syncPlaneRefWatch (a ref-set change from
        // projectEdges, delete, undo/redo must re-watch sources on THIS evaluation);
        // refresh never changes ref nodeIds, so watching post-refresh refs is equal.
        const data = this.data;
        this.syncExternalRefWatch(data.externalRefs ?? []);
        const edges: IEdge[] = [];
        for (const entity of data.entities) {
            const edge = this.entityEdge(entity);
            if (!edge.isOk) return edge;
            edges.push(edge.value);
        }
        // Profile-role external refs join the shape as real edges, after the sketch's
        // own entities — shapeEntityIds(data) maps edge indexes back to entity ids on
        // the crossing path. Reference-role externals never enter shape building.
        for (const ref of profileExternalRefs(data)) {
            const edge = this.entityEdge({ id: ref.entityId, type: ref.type, params: ref.snapshot });
            if (!edge.isOk) return edge;
            edges.push(edge.value);
        }
        // A sketch is a set of possibly disjoint entities; a wire requires connected
        // edges (shapeFactory.wire fails with DisconnectedWire otherwise), so entities
        // are combined into a compound — empty when every entity was deleted, which
        // keeps the visual in sync instead of leaving a stale ghost behind.
        // Use convert.toWire/toFace downstream when a closed profile is needed.
        if (edges.length === 1) {
            return Result.ok(edges[0]);
        }
        return shapeFactory.combine(edges);
    }

    private entityEdge(entity: SketchEntityData): Result<IEdge> {
        const p = entity.params;
        switch (entity.type) {
            case "line":
                return shapeFactory.line(toWorld(this.plane, p[0], p[1]), toWorld(this.plane, p[2], p[3]));
            case "circle":
                return shapeFactory.circle(this.plane.normal, toWorld(this.plane, p[0], p[1]), p[2]);
            case "arc":
                return this.arcEdge(p as [number, number, number, number, number, number]);
        }
    }

    /** arc params = [cx, cy, sx, sy, ex, ey]; the end point only fixes the sweep angle. */
    private arcEdge(params: [number, number, number, number, number, number]): Result<IEdge> {
        const [cx, cy, sx, sy] = params;
        if (Math.hypot(sx - cx, sy - cy) < Precision.Distance) {
            return Result.err("Arc radius is too small");
        }
        // Only a raw sweep of [0, Precision.Angle] is degenerate (start and end on
        // the same ray, within angular tolerance). A small NEGATIVE raw sweep is a
        // legitimate near-full-circle arc — arcAngles normalizes it to just under
        // 2π — and must build.
        const rawSweep = rawArcSweep(params);
        if (rawSweep >= 0 && rawSweep <= Precision.Angle) {
            return Result.err("Arc is degenerate (zero sweep)");
        }
        const [, sweep] = arcAngles(params);
        return shapeFactory.arc(
            this.plane.normal,
            toWorld(this.plane, cx, cy),
            toWorld(this.plane, sx, sy),
            (sweep * 180) / Math.PI,
        );
    }

    /** Watches the node the plane reference points at; unresolved ids are retried next evaluation. */
    private syncPlaneRefWatch(): void {
        const ref = this.planeRef;
        const node =
            ref === undefined ? undefined : this.document.modelManager.findNode((n) => n.id === ref.nodeId);
        if (node === this._planeRefNode) return;
        if (this._planeRefNode !== undefined && isPropertyChanged(this._planeRefNode)) {
            this._planeRefNode.removePropertyChanged(this.handlePlaneRefNodeChanged);
        }
        this._planeRefNode = node;
        if (node !== undefined && isPropertyChanged(node)) {
            node.onPropertyChanged(this.handlePlaneRefNodeChanged);
        }
    }

    /** Follows the referenced face: a source rebuild or a move carries the sketch plane with it. */
    private readonly handlePlaneRefNodeChanged = (property: string) => {
        if (property !== "shape" && property !== "transform") return;
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            if (this.followPlaneRef()) {
                this.setShape(this.generateShape());
            }
        } finally {
            history.disabled = disabled;
        }
    };

    /**
     * Re-resolves the plane against the referenced face, anchored to the sketch's
     * timeline position (`SketchData.refPositions`) like the external references:
     * the plane belongs to the source's shape AT the anchor, so a downstream
     * feature moving or splitting the captured face does not drag the sketch
     * along. Persisted untransacted (derived state, refreshExternalRefs-style) —
     * every trigger path (mid-chain follow, source watch, transform watch)
     * re-derives it, so an undo replays through the same resolution.
     *
     * Must run BEFORE `refreshExternalRefs` (ref snapshots are plane-local UVs).
     * It is also the ONLY plane follow that runs mid-chain: a ref edge sliding
     * along the plane normal keeps its UV snapshot, so the ref resolution alone
     * reports "unchanged" and the sketch would regenerate at its stale world
     * position — a cut through it turns into a no-op, a downstream feature fails
     * the chain, the source never emits a shape change, and the plane stays
     * wedged at the old spot for good.
     */
    private followPlaneRef(): boolean {
        const ref = this.planeRef;
        if (ref === undefined) return false;
        const node = this.document.modelManager.findNode((n) => n.id === ref.nodeId);
        if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) {
            // A rolled-back body shows a transient preview shape lacking every face
            // born from a later feature; bystander sketches never resolve against
            // it. The session owner does — the rollback reveals the capture-time
            // geometry — but only while the rollback still reaches the sketch's
            // timeline anchor: an undercutting rollback (propagated from a body the
            // source consumes) shows an EARLIER state than capture time, so the
            // captured face can be hidden and resolving would hop the plane to the
            // nearest same-normal face. Freeze exactly like the external refs
            // (sourceEdges in externalRef.ts); the restore on session exit
            // re-resolves with the flag already cleared.
            if (!this._editingSession) return false;
            const anchor = this.data.refPositions?.[ref.nodeId];
            if (anchor === undefined || node.rollbackIndex < anchor) return false;
        }
        // The face can be gone mid-rebuild; keep the last plane then.
        const plane = resolveFacePlane(this.document, ref, this.data.refPositions);
        if (plane === undefined || this.isSamePlane(plane)) return false;
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            // setProperty (not the shape-changing variant): the caller regenerates.
            this.setProperty("plane", plane);
        } finally {
            history.disabled = disabled;
        }
        return true;
    }

    private isSamePlane(plane: Plane): boolean {
        return plane.origin.isEqualTo(this.plane.origin) && plane.normal.isEqualTo(this.plane.normal);
    }

    /** Source nodes of the external references being watched, keyed by node id. */
    private _externalRefNodes = new Map<string, INode>();

    /** True while a `SketchEditor` session owns this node's solver and dataJson. */
    private _editingSession = false;

    get editingSession(): boolean {
        return this._editingSession;
    }

    /** Marks editor-session ownership; set by `SketchEditor` on entry, cleared on dispose. */
    setEditingSession(value: boolean): void {
        this._editingSession = value;
    }

    /**
     * Edge-triggered handoff from `handleExternalRefNodeChanged`: the handler resolves
     * first (it needs the staleness verdict) and then regenerates — the flag keeps the
     * immediately following `generateShape` from paying for a whole second resolution
     * (findSubShapes + fingerprint matching per ref). Set ONLY there, and consumed
     * take-and-clear at `generateShape` entry, so a throw mid-evaluation cannot leak
     * it into the next one (a leftover would skip that evaluation's resolution).
     */
    private _externalRefsFresh = false;

    /**
     * Re-resolves the external references against their source nodes and persists
     * the result untransacted (refreshProfileRefs-style: derived state, no shape
     * change of its own). Parametric-body sources are read at the sketch's
     * timeline anchor (`SketchData.refPositions`), so a downstream feature
     * consuming the referenced edge (a cut into it) never dangles or re-anchors
     * the ref — the resolution mirrors what the sketch editor's rollback shows.
     * Hand-edited or legacy snapshots of the wrong length are normalized first,
     * so the persisted data self-heals on the next write. Called from
     * `generateShape`, so every evaluation works on fresh geometry.
     *
     * Constraints targeting an external reference must follow its geometry, but the
     * solver only lives during an editor session — so a geometry change also runs an
     * off-session solve (the equivalent of entering and leaving the editor) and the
     * solved entity params are persisted the same untransacted way.
     *
     * Returns whether the sketch shape is stale afterwards: entities moved in the
     * re-solve, or a profile-role ref's geometry changed (reference-role geometry
     * never enters the shape).
     */
    private refreshExternalRefs(): boolean {
        const data = this.data;
        const refs = data.externalRefs ?? [];
        if (refs.length === 0) {
            // The last ref may have been deleted while the warning state was set.
            this.updateDanglingWarning(refs);
            return false;
        }
        let mutated = false;
        for (const ref of refs) {
            const snapshot = normalizeSnapshot(ref.type, ref.snapshot);
            if (snapshot !== ref.snapshot) {
                ref.snapshot = snapshot;
                mutated = true;
            }
        }
        const results = resolveExternalRefs(this.document, this.plane, refs, data.refPositions, {
            // The session owner's refs must follow the rolled-back body (the editor
            // seeds the capture-time geometry from them); bystanders skip it.
            includeRolledBackSources: this._editingSession,
        });
        this.updateDanglingWarning(refs);
        let shapeStale = false;
        const movedEntityIds = new Set<number>();
        for (const result of results) {
            if (result.mutated) mutated = true;
            if (!result.geometryChanged) continue;
            movedEntityIds.add(result.ref.entityId);
            if (result.ref.role === "profile") shapeStale = true;
        }
        if (!mutated) return false;
        // The off-session solve pays off only when a moved external is constrained
        // against sketch entities — nothing else can follow it.
        const solved = constraintsReferenceAny(data.constraints, movedEntityIds)
            ? this.solveExternalFollowers(data)
            : undefined;
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            // setProperty (not the shape-changing variant): the caller regenerates
            // the shape — this only persists the re-resolved refs and solved entities.
            this.setProperty("dataJson", JSON.stringify(solved ?? data));
        } finally {
            history.disabled = disabled;
        }
        return solved !== undefined || shapeStale;
    }

    /**
     * Syncs the derived warning state after a resolution pass. The tree badge is a
     * plain propertyChanged emission (the rows already listen to node properties —
     * no new channel); the toast is transition-triggered: it fires only when the
     * dangling profile set changed into a NEW non-empty set, so repeated
     * resolutions of the same set stay silent, a grown set re-notifies, and a full
     * recovery (empty set) resets the signature so a later loss notifies again.
     * Reference-role refs never count — only profile roles degrade built geometry
     * to the frozen snapshot.
     */
    private updateDanglingWarning(refs: ExternalRefData[]): void {
        const danglingIds = danglingProfileRefIds(refs);
        const signature = danglingIds.join(",");
        const setChanged = signature !== this._danglingSignature;
        this._danglingSignature = signature;
        if (this._danglingProfileCount !== danglingIds.length) {
            const oldCount = this._danglingProfileCount;
            this._danglingProfileCount = danglingIds.length;
            this.emitPropertyChanged("warningCount", oldCount);
        }
        if (setChanged && signature !== "") {
            PubSub.default.pub("showToast", this.warningTooltip, danglingIds.length);
        }
    }

    /**
     * Off-session re-solve of the sketch against moved external geometry, returning
     * the solved data when any entity moved (undefined when nothing moved, while a
     * live editor session owns the re-solve, or when the data cannot be loaded — a
     * sketch the solver rejects keeps its entities and the editor surfaces the
     * problem on the next session). A conflicting solve still returns its
     * best-effort positions, which is what opening the editor would show.
     */
    private solveExternalFollowers(data: SketchData): SketchData | undefined {
        if (this._editingSession) return undefined;
        let solved: SketchData;
        try {
            // No explicit solve here: the constructor's loadData already ends with the
            // full solve that pulls constrained entities onto the moved external
            // geometry — a second solve(true) on unchanged state is a no-op.
            const solver = new SketchSolver(this.plane, data);
            try {
                solved = solver.toData();
            } finally {
                solver.dispose();
            }
        } catch {
            return undefined;
        }
        if (!entitiesMoved(data.entities, solved.entities)) return undefined;
        // the solver does not carry dimension-label anchors — keep them
        if (data.anchors !== undefined) solved.anchors = data.anchors;
        return solved;
    }

    /** Watches every distinct external-reference source node; dropped refs unwatch. */
    private syncExternalRefWatch(refs: ReadonlyArray<{ nodeId: string }>): void {
        syncNodeWatches(
            this.document,
            this._externalRefNodes,
            new Set(refs.map((ref) => ref.nodeId)),
            this.handleExternalRefNodeChanged,
        );
    }

    /**
     * Re-resolves the external references and regenerates when anything visible
     * changed (the resolution and the off-session solve run inside
     * `refreshExternalRefs`). Shared by the source-watch handler and by a consuming
     * parametric body: the body's chain calls it before evaluating a feature that
     * reads this sketch, so the first pass already works on post-edit geometry —
     * the watch handler's catch-up pass only runs after a successful chain, and a
     * stale first pass that fails (e.g. a cut whose sketch no longer intersects the
     * rebuilt body) would otherwise wedge the chain with the error surfacing on the
     * wrong feature.
     */
    followExternalRefs(): void {
        // Plane first: ref snapshots are plane-local UVs, so a moved plane changes
        // what the refs resolve to — and a plane move alone never shows up in the
        // ref resolution at all (see followPlaneRef).
        // Everything here is derived state (refs, plane, shape all re-resolve from
        // the persisted dataJson/planeRefJson), so nothing may enter the undo
        // history: a recorded sketch shape would be restored BEFORE the causative
        // edit's own record (records undo in reverse), re-evaluating the body in a
        // mixed state that never existed.
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            const planeStale = this.followPlaneRef();
            if (this.refreshExternalRefs() || planeStale) {
                // the immediately following generateShape inherits this resolution
                this._externalRefsFresh = true;
                this.setShape(this.generateShape());
            }
        } finally {
            history.disabled = disabled;
        }
    }

    /** A source rebuild or move re-resolves the refs (see `followExternalRefs`). */
    private readonly handleExternalRefNodeChanged = (property: string) => {
        if (property !== "shape" && property !== "transform") return;
        this.followExternalRefs();
    };

    override disposeInternal(): void {
        if (this._planeRefNode !== undefined && isPropertyChanged(this._planeRefNode)) {
            this._planeRefNode.removePropertyChanged(this.handlePlaneRefNodeChanged);
        }
        this._planeRefNode = undefined;
        for (const node of this._externalRefNodes.values()) {
            if (isPropertyChanged(node)) node.removePropertyChanged(this.handleExternalRefNodeChanged);
        }
        this._externalRefNodes.clear();
        super.disposeInternal();
    }
}

/**
 * Profile-role external refs whose source edge no longer resolves — parametric-body
 * sources are read at the sketch's timeline anchor, so an edge merely consumed by a
 * downstream feature never lands here; a dangling flag is a genuine loss. The
 * sketch keeps building their profiles from the stale snapshot (drawn red in the
 * editor), so a dependent feature works on frozen geometry — surfaced as
 * feature-level warnings.
 */
export function danglingProfileRefs(sketch: SketchNode): ExternalRefData[] {
    return (sketch.data.externalRefs ?? []).filter((ref) => ref.role === "profile" && ref.dangling === true);
}

/**
 * Sorted entity ids of the dangling profile-role refs — the join of this list is the
 * set signature the loss toast dedups on (sorted so resolution order cannot fake a
 * set change).
 */
function danglingProfileRefIds(refs: ExternalRefData[]): number[] {
    return refs
        .filter((ref) => ref.role === "profile" && ref.dangling === true)
        .map((ref) => ref.entityId)
        .sort((a, b) => a - b);
}

/** True when any constraint references one of the given entity ids. */
function constraintsReferenceAny(
    constraints: SketchConstraintData[],
    entityIds: ReadonlySet<number>,
): boolean {
    return constraints.some((constraint) => constraint.refs.some((ref) => entityIds.has(ref.entityId)));
}

/** Whether any stored entity param moved beyond tolerance (ids and layout are stable). */
function entitiesMoved(before: SketchEntityData[], after: SketchEntityData[]): boolean {
    if (before.length !== after.length) return true;
    for (let i = 0; i < before.length; i++) {
        const a = before[i];
        const b = after[i];
        if (a.id !== b.id || a.params.length !== b.params.length) return true;
        for (let p = 0; p < a.params.length; p++) {
            if (Math.abs(a.params[p] - b.params[p]) > Precision.Distance) return true;
        }
    }
    return false;
}
