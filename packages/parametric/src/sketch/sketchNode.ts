// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EdgeMeshData,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type INode,
    type IShape,
    type IShapeMeshData,
    isPropertyChanged,
    LENGTH_UNITS,
    Matrix4,
    MultiShapeMesh,
    ParameterShapeNode,
    type Plane,
    Precision,
    PubSub,
    property,
    Result,
    serializable,
    serialize,
    VisualConfig,
    type VisualItemConfig,
    type XYZ,
} from "@chili3d/core";
import { allProfiles, sketchProfiles } from "../features/profileBuilder";
import { syncNodeWatches } from "../nodeWatch";
import { ensureVariableSync } from "../variableSync";
import {
    conicWeight,
    curveControlPoints,
    ellipseAxes,
    ellipseSweep,
    entityDomain,
    entityTangentAt,
    evaluateEntity,
    nurbsSpec,
    nurbsWeights,
    offsetDrawnWindow,
    offsetSideSign,
} from "./curveEval";
import { normalizeSnapshot } from "./entityLayout";
import { type ExternalResolveResult, resolveExternalRefs } from "./externalRef";
import { type DatumPlaneName, datumPlaneOf, type PlaneFaceRef, resolveFacePlane } from "./planeRef";
import {
    arcAngles,
    type ExternalRefData,
    profileEntities,
    profileExternalRefs,
    rawArcSweep,
    SKETCH_EDGE_LINE_WIDTH,
    type SketchConstraintData,
    type SketchData,
    type SketchEntityData,
    shapeEntityIds,
    sketchConstraintColor,
    toWorld,
} from "./sketchModel";
import { SketchSolver } from "./solver";

export interface SketchNodeOptions {
    document: IDocument;
    plane: Plane;
    /** Present when the plane was captured from a solid's face; the sketch follows that face. */
    planeRef?: PlaneFaceRef;
    /** Serialized form produced by the Serializer; takes precedence over `planeRef`. */
    planeRefJson?: string;
    /** Present when the plane was picked on a global datum; the sketch offsets from it. */
    datumPlane?: DatumPlaneName;
    /** Signed distance from the base plane along its normal. See `planeOffset`. */
    planeOffset?: number;
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

    /** `INodeIcon`: a sketch reads as a sketch, not as the solid it feeds. */
    override get icon(): string {
        return "icon-sketchEdit";
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
     * The global datum plane the sketch was created on, when it was not a solid face.
     * Together with `planeOffset` it is what `plane` is re-derived from.
     */
    @serialize()
    get datumPlane(): DatumPlaneName | undefined {
        return this.getPrivateValue("datumPlane");
    }

    /**
     * Signed distance of the sketch plane from its base plane, along that plane's
     * normal. With the base plane — `planeRef` for a solid face, `datumPlane` for a
     * global datum — this is the authoritative definition of where the sketch sits;
     * `plane` is the derived result (see `reapplyPlane`). A plan without a recorded
     * base (a document saved before this existed) simply keeps its stored `plane`.
     */
    @serialize()
    @property("option.command.planeOffset", { unit: LENGTH_UNITS })
    get planeOffset(): number {
        return this.getPrivateValue("planeOffset", 0);
    }
    /** Editing the offset moves the plane, so this is a shape-changing write. */
    set planeOffset(value: number) {
        if (this.planeOffset === value) return;
        if (this.setProperty("planeOffset", value)) {
            // Re-derive before regenerating: generateShape reads the plane.
            this.reapplyPlane();
            this.setShape(this.generateShape());
        }
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
        this.setPrivateValue("datumPlane", options.datumPlane);
        this.setPrivateValue("planeOffset", options.planeOffset ?? 0);
        this.setPrivateValue(
            "dataJson",
            options.dataJson ?? JSON.stringify(options.data ?? { entities: [], constraints: [] }),
        );
        const danglingIds = danglingProfileRefIds(this.data.externalRefs ?? []);
        this._danglingProfileCount = danglingIds.length;
        this._danglingSignature = danglingIds.join(",");
        ensureVariableSync(options.document);
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

    /**
     * Entity ids the constraints pin down completely, or undefined when nothing is
     * colouring this sketch. Derived and session-scoped — never serialized, never part of
     * the shape; it only picks the per-segment colours the mesh is built with.
     */
    private _fullyConstrained?: ReadonlySet<number>;
    private _watchingConstraintColors = false;

    /**
     * Colours the sketch by constraint state, the way the sketch editor wants it: the
     * entities in `ids` draw in the default edge colour, everything else in
     * `VisualConfig.sketchFreeColor`. `undefined` drops the colouring and the sketch goes
     * back to one flat colour, which is what leaving the editor does.
     */
    setConstraintColors(ids: ReadonlySet<number> | undefined): void {
        if (this._fullyConstrained === ids) return;
        this._fullyConstrained = ids;
        this.syncConstraintColorWatch();
        this._mesh = undefined;
        this.emitPropertyChanged("shape", this._shape);
    }

    /**
     * The free colour is baked into the mesh's vertex colours, so unlike the shared edge
     * materials it cannot follow a theme switch in place. While this node is colouring, a
     * change to either colour has to rebuild the mesh — after that it is nobody's to update.
     */
    private syncConstraintColorWatch(): void {
        const shouldWatch = this._fullyConstrained !== undefined;
        if (shouldWatch === this._watchingConstraintColors) return;
        this._watchingConstraintColors = shouldWatch;
        if (shouldWatch) VisualConfig.onPropertyChanged(this.handleConstraintColorChanged);
        else VisualConfig.removePropertyChanged(this.handleConstraintColorChanged);
    }

    private readonly handleConstraintColorChanged = (property: keyof VisualItemConfig) => {
        if (property !== "sketchFreeColor" && property !== "defaultEdgeColor") return;
        this._mesh = undefined;
        this.emitPropertyChanged("shape", this._shape);
    };

    protected override createMesh(): IShapeMeshData {
        const mesh = this.sketchMesh();
        const edges = mesh.edges;
        if (edges === undefined) return mesh;
        // A fresh mesh with a fresh edges object, never the ones handed in: `sketchMesh`
        // may be returning the shape's own mesh, and writing this session's width or
        // colours into that would outlive the session — the colouring would stick after
        // the editor closed. Built field by field because `sketchMesh` may hand back a
        // `MultiShapeMesh`, whose accessors a spread would not carry over.
        return {
            edges: { ...edges, lineWidth: SKETCH_EDGE_LINE_WIDTH, color: this.edgeColors(edges) },
            faces: mesh.faces,
            vertexs: mesh.vertexs,
        };
    }

    /**
     * The per-segment colours for the current constraint state, or the flat colour the
     * kernel reported when no session is colouring. The compound's edges are in
     * `buildEdges` order — the sketch's own entities, then the profile-role externals —
     * which is exactly what `shapeEntityIds` lists, and `range[i]` is edge i's vertex
     * span, so the colours line up without a second mapping.
     */
    private edgeColors(edges: EdgeMeshData): number | number[] {
        const pinned = this._fullyConstrained;
        if (pinned === undefined) return edges.color ?? VisualConfig.defaultEdgeColor;
        return constraintEdgeColors(edges.range, shapeEntityIds(this.data), pinned);
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

        const edges = this.buildEdges(data);
        if (!edges.isOk) return Result.err(edges.error);
        // A sketch is a set of possibly disjoint entities; a wire requires connected
        // edges (shapeFactory.wire fails with DisconnectedWire otherwise), so entities
        // are combined into a compound — empty when every entity was deleted, which
        // keeps the visual in sync instead of leaving a stale ghost behind.
        // Use convert.toWire/toFace downstream when a closed profile is needed.
        if (edges.value.length === 1) {
            return Result.ok(edges.value[0]);
        }
        return shapeFactory.combine(edges.value);
    }

    /** The sketch's own non-construction entity edges, followed by the profile-role external refs. */
    private buildEdges(data: SketchData): Result<IEdge[]> {
        const edges: IEdge[] = [];
        // Construction entities are solver-only reference geometry — they never
        // enter the shape, exactly like reference-role external refs below.
        for (const entity of profileEntities(data)) {
            const edge = this.entityEdge(entity);
            if (!edge.isOk) return Result.err(edge.error);
            edges.push(edge.value);
        }
        // Profile-role external refs join the shape as real edges, after the sketch's
        // own entities — shapeEntityIds(data) maps edge indexes back to entity ids on
        // the crossing path. Reference-role externals never enter shape building.
        for (const ref of profileExternalRefs(data)) {
            const edge = this.entityEdge({ id: ref.entityId, type: ref.type, params: ref.snapshot });
            if (!edge.isOk) return Result.err(edge.error);
            edges.push(edge.value);
        }
        return Result.ok(edges);
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
            case "ellipse":
                return this.ellipseEdge(p);
            case "ellipseArc":
                return this.ellipseArcEdge(p);
            case "conic":
                return this.conicEdge(p);
            case "bezier":
                return this.bezierEdge(p);
            case "nurbs":
                return this.nurbsEdge(entity);
            case "offsetCurve":
                return this.offsetCurveEdge(entity);
        }
    }

    /** One offset copy's edge, built off its source's own edge and cut to the window drawn. */
    private offsetCurveEdge(entity: SketchEntityData): Result<IEdge> {
        const ref = entity.offset;
        if (ref === undefined) return Result.err("An offset curve carries no offset");
        // its params are the source's, so the basis is the source's own edge, built
        // the same way the source's would be
        const source: SketchEntityData = {
            id: entity.id,
            type: ref.sourceType,
            params: entity.params,
            ...(entity.nurbs === undefined ? {} : { nurbs: entity.nurbs }),
        };
        const basis = this.entityEdge(source);
        if (!basis.isOk) return Result.err(basis.error);
        // the edge's own offset: the kernel holds the pair (basis, distance) as a
        // `Geom_OffsetCurve` rather than deriving a curve of some other kind
        const offset = basis.value.offset(this.offsetReach(source, ref.distance), this.plane.normal);
        // the window the canvas draws, not the one the entity stores: a source that has
        // moved out from under its window leaves a stretch the copy no longer covers,
        // and the two readers have to clamp it the same way or the built edge would be
        // a piece of a curve the drawing does not show
        const window = offsetDrawnWindow(entity);
        if (!offset.isOk || window === undefined) return offset;
        // a trimmed copy: the kernel's offset shares its basis's parameter, so the
        // window is cut straight out of it. `trim` answers `undefined` for a window
        // that is empty within tolerance — which is a copy with nothing left.
        const trimmed = offset.value.trim(window[0], window[1]);
        return trimmed === undefined
            ? Result.err("The offset copy is too short to build")
            : Result.ok(trimmed);
    }

    /**
     * The signed distance the kernel is handed for an offset curve.
     *
     * `offsetOps` measures a positive distance along the curve's **left** normal (and, for a
     * closed source, outward — `offsetSideSign`), while the kernel's own `offset` moves along
     * the *right* of the curve's direction: `edge.offset(1, +Z)` on an edge running along +x
     * comes out at y = −1, not y = +1. Measured, and easy to get backwards — the two readings
     * agree on nothing but their zero. So the reach the op computed is negated on the way in,
     * and the shape lands where the drawing already shows the copy.
     *
     * The side is read once, at the middle: for the curves a sketch offsets it is the same at
     * every point along them (a closed one is convex, so "outward" faces the same way round).
     */
    private offsetReach(source: SketchEntityData, distance: number): number {
        const [start, end] = entityDomain(source);
        const middle = (start + end) / 2;
        const tangent = entityTangentAt(source, middle);
        const norm = Math.hypot(tangent[0], tangent[1]);
        if (norm < 1e-12) return distance;
        const side = offsetSideSign(
            source,
            evaluateEntity(source, middle),
            -tangent[1] / norm,
            tangent[0] / norm,
        );
        return -side * distance;
    }

    /**
     * The ellipse's frame for the kernel, and how the drawn parameters map onto it. The
     * axes are orthogonalized defensively (the structural constraint keeps m ⊥ n, but a
     * mid-drag cache can lag). The kernel wants a right-handed major-first frame, so:
     * the minor axis is flipped to the counter-clockwise side of the major when the drawn
     * pair is clockwise (`ccw` — same point set, the parameter negates), and the axes
     * swap when the minor is the longer (`swapped` — OCCT wants major ≥ minor, and the
     * parameter shifts a quarter turn). `xdir` is the sketch-space direction of the
     * kernel's major axis.
     */
    private ellipseKernelFrame(p: readonly number[]):
        | {
              center: XYZ;
              xdir: [number, number];
              major: number;
              minor: number;
              ccw: boolean;
              swapped: boolean;
          }
        | undefined {
        const { center, u, v } = ellipseAxes(p);
        // n with its component along m removed: the perpendicular the constraint asks for
        const uu = u[0] * u[0] + u[1] * u[1];
        const vOrtho: [number, number] =
            uu < 1e-24
                ? v
                : [
                      v[0] - ((v[0] * u[0] + v[1] * u[1]) / uu) * u[0],
                      v[1] - ((v[0] * u[0] + v[1] * u[1]) / uu) * u[1],
                  ];
        const uLength = Math.hypot(u[0], u[1]);
        const vLength = Math.hypot(vOrtho[0], vOrtho[1]);
        if (uLength < Precision.Distance || vLength < Precision.Distance) return undefined;
        const ccw = u[0] * vOrtho[1] - u[1] * vOrtho[0] > 0;
        const swapped = vLength > uLength;
        const vCanonical: [number, number] = ccw ? vOrtho : [-vOrtho[0], -vOrtho[1]];
        return {
            center: toWorld(this.plane, center[0], center[1]),
            xdir: swapped ? vCanonical : u,
            major: Math.max(uLength, vLength),
            minor: Math.min(uLength, vLength),
            ccw,
            swapped,
        };
    }

    private ellipseEdge(p: readonly number[]): Result<IEdge> {
        const frame = this.ellipseKernelFrame(p);
        if (frame === undefined) return Result.err("Ellipse is degenerate (an axis collapsed)");
        return shapeFactory.ellipse(
            this.plane.normal,
            frame.center,
            toWorld(this.plane, frame.xdir[0], frame.xdir[1]).sub(this.plane.origin),
            frame.major,
            frame.minor,
        );
    }

    /**
     * The ellipseArc as the swept piece of its ellipse: the full ellipse edge trimmed to
     * the [tStart, tEnd] parameter range (`ellipseSweep`; the kernel's ellipse parameter
     * matches the c + u·cos t + v·sin t reading). A zero sweep is no edge at all. The
     * range is mapped through the kernel frame's two adjustments (`ellipseKernelFrame`):
     * a clockwise drawn pair negates it, a minor-longer swap shifts it a quarter turn.
     */
    private ellipseArcEdge(p: readonly number[]): Result<IEdge> {
        const [tStart, tEnd] = ellipseSweep(p);
        if (tEnd - tStart <= Precision.Angle) return Result.err("Ellipse arc is degenerate (zero sweep)");
        const ellipse = this.ellipseEdge(p);
        if (!ellipse.isOk) return ellipse;
        const frame = this.ellipseKernelFrame(p)!;
        let [from, to] = frame.ccw ? [tStart, tEnd] : [-tEnd, -tStart];
        if (frame.swapped) {
            from -= Math.PI / 2;
            to -= Math.PI / 2;
        }
        const edge = ellipse.value.trim(from, to);
        return edge === undefined ? Result.err("Ellipse arc trim failed") : Result.ok(edge);
    }

    /**
     * The conic as its rational quadratic bezier: weights [1, w, 1] with w = ρ/(1−ρ).
     * ρ is kept a hair inside (0, 1) — a 0 is a straight line the kernel's bezier can
     * still carry, a 1 is no curve at all.
     */
    private conicEdge(p: readonly number[]): Result<IEdge> {
        const rho = Math.min(1 - 1e-6, Math.max(1e-6, p[6]));
        const points = [
            toWorld(this.plane, p[0], p[1]),
            toWorld(this.plane, p[2], p[3]),
            toWorld(this.plane, p[4], p[5]),
        ];
        return shapeFactory.bezier(points, [1, conicWeight(rho), 1]);
    }

    /** The cubic bezier as the kernel's Bezier through its four control poles. */
    private bezierEdge(p: readonly number[]): Result<IEdge> {
        const points: XYZ[] = [];
        for (let i = 0; i + 1 < p.length; i += 2) {
            points.push(toWorld(this.plane, p[i], p[i + 1]));
        }
        return shapeFactory.bezier(points);
    }

    /**
     * The NURBS as the kernel's own rational B-spline: the control points and weights the
     * entity solves with, read against the knots it carries. The kernel wants the flat knot
     * vector this entity stores as it is (see `IShapeFactory.bspline`), so the drawn curve
     * and the solved one are the same curve — a piece of one that a trim left behind keeps
     * its own knots and is built exactly, not refitted.
     */
    private nurbsEdge(entity: SketchEntityData): Result<IEdge> {
        const spec = nurbsSpec(entity);
        const poles = curveControlPoints(entity).map(([u, v]) => toWorld(this.plane, u, v));
        return shapeFactory.bspline(poles, nurbsWeights(entity.params), spec.knots, spec.degree);
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

    /**
     * Runs work that only re-derives state — the plane, the external refs, the solved entities,
     * the shape — with the undo history silenced.
     *
     * A recorded derived write would be restored BEFORE the causative edit's own record
     * (records undo in reverse), re-evaluating the body in a mixed state that never existed.
     * Every write below is reachable from a trigger that re-derives it anyway, so nothing is
     * lost by leaving it out of the history.
     */
    private withoutHistory<T>(action: () => T): T {
        const history = this.document.history;
        const disabled = history.disabled;
        history.disabled = true;
        try {
            return action();
        } finally {
            history.disabled = disabled;
        }
    }

    /** Follows the referenced face: a source rebuild or a move carries the sketch plane with it. */
    private readonly handlePlaneRefNodeChanged = (property: string) => {
        if (property !== "shape" && property !== "transform") return;
        this.withoutHistory(() => {
            if (this.followPlaneRef()) {
                this.setShape(this.generateShape());
            }
        });
    };

    /**
     * Re-resolves the plane against the referenced face, anchored to the sketch's timeline
     * position (`SketchData.refPositions`) like the external references.
     *
     * - **Anchored, not live.** The plane belongs to the source's shape AT the anchor, so a
     *   downstream feature moving or splitting the captured face does not drag the sketch along.
     * - **Derived state.** Persisted untransacted (refreshExternalRefs-style): every trigger path
     *   — mid-chain follow, source watch, transform watch — re-derives it, so an undo replays
     *   through the same resolution.
     * - **Ordering.** Must run BEFORE `refreshExternalRefs`, whose ref snapshots are plane-local UVs.
     * - **Why it is the only plane follow that runs mid-chain.** A ref edge sliding along the
     *   plane normal keeps its UV snapshot, so the ref resolution alone reports "unchanged" and
     *   the sketch would regenerate at its stale world position: a cut through it turns into a
     *   no-op, a downstream feature fails the chain, the source never emits a shape change, and
     *   the plane stays wedged at the old spot for good.
     */
    private followPlaneRef(): boolean {
        // Only a face reference moves; the datum planes never do.
        if (this.planeRef === undefined) return false;
        return this.reapplyPlane();
    }

    /**
     * The plane the offset is measured from: a global datum by name, or the referenced
     * face re-resolved on the source's current geometry. Undefined when there is no base
     * to re-derive from — then `plane` keeps whatever it was saved with.
     */
    private resolveBasePlane(): Plane | undefined {
        if (this.datumPlane !== undefined) return datumPlaneOf(this.datumPlane);
        const ref = this.planeRef;
        if (ref === undefined) return undefined;
        // A frozen source (a transient rollback preview, see `isFrozenSource`) yields no
        // plane, exactly like a face that is gone mid-rebuild — the sketch keeps the
        // last one. The session owner passes `includeRolledBackSources` so an
        // undercutting rollback still freezes; the restore on session exit re-resolves
        // with the flag already cleared.
        return resolveFacePlane(this.document, ref, this.data.refPositions, {
            includeRolledBackSources: this._editingSession,
        });
    }

    /**
     * Re-derives `plane` from the base plane and the current offset. Derived state, so
     * the write is untransacted: every trigger re-derives it anyway.
     */
    private reapplyPlane(): boolean {
        const base = this.resolveBasePlane();
        if (base === undefined) return false;
        const plane = base.offsetAlongNormal(this.planeOffset);
        if (this.isSamePlane(plane)) return false;
        // setProperty (not the shape-changing variant): the caller regenerates.
        this.withoutHistory(() => this.setProperty("plane", plane));
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

    /** The parameter-table revision this sketch last re-solved against (see `applyVariables`). */
    private _variableRevision: number | undefined;

    /** `IVariableConsumer`: sketches re-solve before the bodies that read them. */
    readonly variableSyncOrder = 0;

    /**
     * Re-resolves the external references against their source nodes, persists the result, and
     * returns whether the sketch shape is stale afterwards.
     *
     * - **Derived state.** Persisted untransacted (refreshProfileRefs-style; no shape change of
     *   its own). Called from `generateShape`, so every evaluation works on fresh geometry.
     * - **Anchored sources.** A parametric-body source is read at the sketch's timeline anchor
     *   (`SketchData.refPositions`), so a downstream feature consuming the referenced edge (a cut
     *   into it) never dangles or re-anchors the ref — the resolution mirrors what the sketch
     *   editor's rollback shows.
     * - **Self-healing snapshots.** Hand-edited or legacy snapshots of the wrong length are
     *   normalized first, so the persisted data heals on the next write.
     * - **Constraints follow the geometry.** A constraint targeting an external reference must
     *   track its geometry, but the solver only lives during an editor session — so a geometry
     *   change also runs an off-session solve (the equivalent of entering and leaving the
     *   editor), its solved entity params persisted the same untransacted way.
     *
     * "Stale" means entities moved in that off-session solve, or a profile-role ref's geometry
     * changed. Reference-role geometry never enters the shape, so it cannot make it stale.
     */
    private refreshExternalRefs(): boolean {
        const data = this.data;
        const refs = data.externalRefs ?? [];
        if (refs.length === 0) {
            // The last ref may have been deleted while the warning state was set.
            this.updateDanglingWarning(refs);
            return false;
        }
        const healedSnapshots = normalizeSnapshots(refs);
        const results = resolveExternalRefs(this.document, this.plane, refs, data.refPositions, {
            // The session owner's refs must follow the rolled-back body (the editor
            // seeds the capture-time geometry from them); bystanders skip it.
            includeRolledBackSources: this._editingSession,
        });
        this.updateDanglingWarning(refs);
        const { mutated, shapeStale, movedEntityIds } = tallyRefResults(results);
        if (!mutated && !healedSnapshots) return false;
        // The off-session solve pays off only when a moved external is constrained
        // against sketch entities — nothing else can follow it.
        const solved = constraintsReferenceAny(data.constraints, movedEntityIds)
            ? this.solveExternalFollowers(data)
            : undefined;
        // setProperty (not the shape-changing variant): the caller regenerates the shape —
        // this only persists the re-resolved refs and solved entities.
        this.withoutHistory(() => this.setProperty("dataJson", JSON.stringify(solved ?? data)));
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
        return this.solveWithScope(data);
    }

    /**
     * Off-session re-solve of the sketch against the document's parameter table,
     * returning the solved data when any entity moved and undefined when the solve was
     * refused or changed nothing. A dimension written as an expression re-reads its
     * value here, which is the whole point of the scope parameter.
     */
    private solveWithScope(data: SketchData): SketchData | undefined {
        let solved: SketchData;
        try {
            // No explicit solve here: the constructor's loadData already ends with the
            // full solve that pulls constrained entities onto the moved external
            // geometry — a second solve(true) on unchanged state is a no-op.
            const solver = new SketchSolver(this.plane, data, this.document.variables.evaluate().scope);
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

    /**
     * `IVariableConsumer`: re-solves after the document's parameters changed, so a
     * dimension driven by an expression follows its new value. Idempotent per table
     * revision, and left to the session while a `SketchEditor` owns the solve (the
     * editor pushes the new scope to its own solver).
     *
     * Derived state, exactly like `followExternalRefs` — the solved positions come
     * back from the persisted dataJson, so nothing here may enter the undo history.
     */
    applyVariables(): void {
        if (this._editingSession) return;
        const revision = this.document.variables.revision;
        if (this._variableRevision === revision) return;
        this._variableRevision = revision;
        const solved = this.solveWithScope(this.data);
        if (solved === undefined) return;
        this.withoutHistory(() => {
            // setProperty, not the shape-changing variant: the regeneration below
            // already reports the change, and this only persists the solved entities.
            this.setProperty("dataJson", JSON.stringify(solved));
            this.setShape(this.generateShape());
        });
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
     * Re-resolves the external references and regenerates when anything visible changed. The
     * resolution and its off-session solve both run inside `refreshExternalRefs`.
     *
     * Two callers, one reason: the source-watch handler, and a consuming parametric body —
     * which calls it BEFORE evaluating a feature that reads this sketch, so the first pass
     * already works on post-edit geometry. The watch handler's catch-up pass only runs after a
     * successful chain, so without the body's call a stale first pass that fails (e.g. a cut
     * whose sketch no longer intersects the rebuilt body) would wedge the chain with the error
     * surfacing on the wrong feature.
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
        this.withoutHistory(() => {
            const planeStale = this.followPlaneRef();
            if (this.refreshExternalRefs() || planeStale) {
                // the immediately following generateShape inherits this resolution
                this._externalRefsFresh = true;
                this.setShape(this.generateShape());
            }
        });
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

/**
 * Heals hand-edited or legacy snapshots of the wrong length in place, so the persisted data
 * comes out normalized on the next write. Returns whether any of them had to be rewritten.
 */
function normalizeSnapshots(refs: ExternalRefData[]): boolean {
    let healed = false;
    for (const ref of refs) {
        const snapshot = normalizeSnapshot(ref.type, ref.snapshot);
        if (snapshot !== ref.snapshot) {
            ref.snapshot = snapshot;
            healed = true;
        }
    }
    return healed;
}

/**
 * What one resolution pass amounts to. Only a profile-role ref can make the shape stale:
 * reference-role geometry never enters the shape.
 */
function tallyRefResults(results: readonly ExternalResolveResult[]): {
    mutated: boolean;
    shapeStale: boolean;
    movedEntityIds: Set<number>;
} {
    let mutated = false;
    let shapeStale = false;
    const movedEntityIds = new Set<number>();
    for (const result of results) {
        if (result.mutated) mutated = true;
        if (!result.geometryChanged) continue;
        movedEntityIds.add(result.ref.entityId);
        if (result.ref.role === "profile") shapeStale = true;
    }
    return { mutated, shapeStale, movedEntityIds };
}

/** True when any constraint references one of the given entity ids. */
function constraintsReferenceAny(
    constraints: SketchConstraintData[],
    entityIds: ReadonlySet<number>,
): boolean {
    return constraints.some((constraint) => constraint.refs.some((ref) => entityIds.has(ref.entityId)));
}

/**
 * The per-vertex colours for a sketch's edges: `entityIds[i]` owns edge i, whose vertices
 * span `ranges[i]`, and it draws in the default edge colour when the constraints pin it
 * and in `VisualConfig.sketchFreeColor` otherwise. `buildEdges` emits the edges in
 * `shapeEntityIds` order, and the kernel reports one range per edge in that same order, so
 * the two arrays line up index for index.
 */
export function constraintEdgeColors(
    ranges: ReadonlyArray<{ count: number }>,
    entityIds: readonly number[],
    pinned: ReadonlySet<number>,
): number[] {
    const colors: number[] = [];
    for (let index = 0; index < ranges.length; index++) {
        const [r, g, b] = linearRgb(sketchConstraintColor(pinned, entityIds[index]));
        for (let vertex = 0; vertex < ranges[index].count; vertex++) colors.push(r, g, b);
    }
    return colors;
}

/**
 * An sRGB hex colour as the linear triple the renderer's vertex colours want
 * (`LineSegments2` reads them straight in the shader, with no conversion of its own).
 * three performs this same srgb→linear step inside `Color.setHex`; parametric does not
 * depend on three, so the one formula it needs is spelled out here.
 */
function linearRgb(hex: number): [number, number, number] {
    const channel = (byte: number) => {
        const srgb = byte / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    return [channel((hex >> 16) & 0xff), channel((hex >> 8) & 0xff), channel(hex & 0xff)];
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
