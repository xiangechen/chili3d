// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Result } from "../foundation";
import type { Line, Plane, XYZ, XYZLike } from "../math";
import type { Continuity, ICurve } from "./curve";
import type {
    ICompound,
    IEdge,
    IFace,
    IShape,
    IShell,
    ISolid,
    IVertex,
    IWire,
    JoinType,
    OffsetMode,
} from "./shape";

export interface TrackedShape {
    shape: IShape;
    /**
     * Every (output, input) face derivation as flat pairs (out0, in0, out1, in1, ...), in
     * ascending input order (identity first for each input). This is the kernel's WHOLE
     * relation, not a first-ancestor-only map: a face MERGED from several inputs records each
     * of them, whichever operation merged it, and "the first ancestor" is derived where a
     * single index is wanted (`primaryAncestors` below) rather than dropped here.
     * A sub-shape no input derives from simply has no pair.
     */
    faceAncestors: number[];
    /**
     * The edge counterpart of `faceAncestors`, emitted alongside it and consumed exactly as it
     * is — by `mapBooleanIds`/`mapOperationIds`/`mapFusedIds` alike, through the pairs
     * `completeTrackedHistory` verified: a fuse of two touching swept prisms reports pairs the
     * geometry contradicts (measured: a merged top edge recorded as derived from a BOTTOM edge),
     * and composing those unverified minted ids naming sub-shapes millimetres away.
     */
    edgeAncestors: number[];
    /**
     * output face index (findSubShapes order) -> input edge index for faces generated
     * from an input edge (a sweep's side faces), -1 = not edge-generated. Lets callers
     * seed side faces with the generating edge's stable id instead of a fragile
     * enumeration-order-scoped one. Absent when the kernel predates this map.
     */
    faceEdgeMap?: number[];
    /**
     * Output face indexes (findSubShapes order) of a sweep's end cap, reported
     * directly by the kernel (LastShape): a prism's top face, a PARTIAL revolve's
     * end cap. Empty for non-sweeps and full-turn revolves (first/last shapes
     * coincide — those keep the geometric probe). Deliberately separate from the
     * derivation: the cap must not claim the profile face's ancestors and collide
     * with the identical bottom/start face. Absent when the kernel predates this
     * channel — callers then fall back to the history-less-face heuristic.
     * A solid loft reports BOTH caps here instead, in [start, end] section order
     * (a vertex end has no cap): loft inputs are wires/vertices, so no derivation
     * channel can name a cap.
     */
    capFaces?: number[];
    /**
     * Output face index (findSubShapes order) -> input face index of the PARALLEL COPY a
     * thicken offsets that face into (its "offset surface"), -1 = not an offset image.
     * A separate channel on purpose: the derivation pairs report the input face as its own
     * descendant AND report the copy off it, so a caller reading only the pairs would stamp
     * one id on two distinct faces (a box top thickened by -2 yields the kept top, 4 rim
     * bands, and a copy 2mm below, the copy derived from the same input face). Only the
     * kernel can tell the copy from the kept face.
     */
    offsetFaceMap?: number[];
    /** The edge counterpart of `offsetFaceMap`. */
    offsetEdgeMap?: number[];
}

/**
 * The FIRST ancestor of every output — one index per output in findSubShapes order, -1 where no
 * input derives it. Most callers want exactly this single index ("is this sub-shape new?",
 * "which input did it come from?"), and it is derived from the pairs rather than emitted beside
 * them, so the two can never disagree and no operation has to decide whether its merges are
 * worth recording. "First" is the smallest input index: the pairs arrive in ascending input
 * order, identity first.
 */
export function primaryAncestors(ancestors: readonly number[] | undefined, count: number): number[] {
    const map = new Array<number>(count).fill(-1);
    // A producer predating the pair channel reports no ancestors at all: every sub-shape is then
    // "new", which is exactly the id-less state tracking degrades to (`trackedIds`).
    if (ancestors === undefined) return map;
    for (let i = 0; i + 1 < ancestors.length; i += 2) {
        const output = ancestors[i];
        if (output >= 0 && output < count && map[output] < 0) map[output] = ancestors[i + 1];
    }
    return map;
}

export interface IShapeFactory {
    readonly kernelName: string;
    edge(curve: ICurve): IEdge;
    face(wire: IWire[]): Result<IFace>;
    faceFromSurface(wires: IWire[], sourceFace: IFace): Result<IFace>;
    /**
     * Minimal bounded planar regions enclosed by `edges` on `plane`: the edges are split
     * at mutual intersections first, so crossing curves (e.g. overlapping sketch
     * rectangles without shared endpoints) yield every bounded region — unlike `face`,
     * which only chains endpoint-connected wires. Dangling edges produce no region.
     * `sources[k]` is the sorted unique indexes of the input edges bounding `faces[k]`.
     */
    facesFromEdges(edges: IEdge[], plane: Plane): Result<{ faces: IFace[]; sources: number[][] }>;
    shell(faces: IFace[]): Result<IShell>;
    solid(shells: IShell[]): Result<ISolid>;
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge>;
    helix(
        origin: XYZLike,
        normal: XYZLike,
        xDir: XYZLike,
        radius: number,
        pitch: number,
        angle: number,
    ): Result<IWire>;
    point(point: XYZLike): Result<IVertex>;
    line(start: XYZLike, end: XYZLike): Result<IEdge>;
    arc(normal: XYZLike, center: XYZLike, start: XYZLike, angle: number): Result<IEdge>;
    circle(normal: XYZLike, center: XYZLike, radius: number): Result<IEdge>;
    rect(plane: Plane, dx: number, dy: number): Result<IFace>;
    polygon(points: XYZLike[]): Result<IWire>;
    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
    ellipse(
        normal: XYZLike,
        center: XYZLike,
        xvec: XYZLike,
        majorRadius: number,
        minorRadius: number,
    ): Result<IEdge>;
    cylinder(normal: XYZLike, center: XYZLike, radius: number, dz: number): Result<ISolid>;
    cone(normal: XYZLike, center: XYZLike, radius: number, radiusUp: number, dz: number): Result<ISolid>;
    sphere(center: XYZLike, radius: number): Result<ISolid>;
    pyramid(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
    wire(edges: IEdge[]): Result<IWire>;
    prism(shape: IShape, vec: XYZ): Result<IShape>;
    pushPull(shape: IShape, face: IShape, vec: XYZ): Result<IShape>;
    fuse(bottom: IShape, top: IShape): Result<IShape>;
    sweep(profile: IShape[], path: IWire, isRoundCorner: boolean): Result<IShape>;
    revolve(profile: IShape, axis: Line, angle: number): Result<IShape>;
    booleanCommon(shape1: IShape[], shape2: IShape[]): Result<IShape>;
    booleanCut(shape1: IShape[], shape2: IShape[]): Result<IShape>;
    booleanFuse(shape1: IShape[], shape2: IShape[], simplifyShape: boolean): Result<IShape>;
    sewing(shapes: IShape[]): Result<IShape>;
    combine(shapes: IShape[]): Result<ICompound>;
    makeThickSolidBySimple(shape: IShape, thickness: number): Result<IShape>;
    /**
     * Tracked thicken: `makeThickSolidBySimple` with kernel history, so the bodies a
     * thicken feature appends keep stable sub-shape ids (see the parametric module).
     */
    makeThickSolidBySimpleTracked?(shape: IShape, thickness: number): Result<TrackedShape>;
    makeThickSolidByJoin(
        shape: IShape,
        openFaces: IShape[],
        thickness: number,
        joinType: JoinType,
        mode?: OffsetMode,
        intersection?: boolean,
    ): Result<IShape>;
    fillet(shape: IShape, edges: number[], radius: number): Result<IShape>;
    chamfer(shape: IShape, edges: number[], distance: number): Result<IShape>;
    prismTracked?(shape: IShape, vec: XYZ): Result<TrackedShape>;
    revolveTracked?(profile: IShape, axis: Line, angle: number): Result<TrackedShape>;
    /**
     * Tracked sweep: ONE profile per call along the whole spine (the TS side loops the
     * profiles and combines — same geometry as the multi-profile `sweep`). The history
     * input is that single profile face; the end-cap face indexes (the sweep's
     * LastShape) travel through `capFaces`, empty for a closed path.
     */
    sweepTracked?(profile: IShape, path: IWire, isRoundCorner: boolean): Result<TrackedShape>;
    /**
     * Tracked loft: the history input enumerates the sections' edges in section order
     * (section 0's edges first), faces of the input are always empty (loft inputs are
     * wires/vertices), and a solid loft's start AND end cap face indexes travel through
     * `capFaces` — neither cap can be named by the derivation channels.
     */
    loftTracked?(
        sections: (IVertex | IEdge | IWire)[],
        isSolid: boolean,
        isRuled: boolean,
        continuity: Continuity,
    ): Result<TrackedShape>;
    booleanCommonTracked?(shape1: IShape[], shape2: IShape[]): Result<TrackedShape>;
    booleanCutTracked?(shape1: IShape[], shape2: IShape[]): Result<TrackedShape>;
    booleanFuseTracked?(shape1: IShape[], shape2: IShape[]): Result<TrackedShape>;
    filletTracked?(shape: IShape, edges: number[], radius: number): Result<TrackedShape>;
    chamferTracked?(shape: IShape, edges: number[], distance: number): Result<TrackedShape>;
    fillet2d(face: IFace, edge1: IEdge, edge2: IEdge, radius: number): Result<IFace>;
    chamfer2d(face: IFace, edge1: IEdge, edge2: IEdge, distance: number): Result<IFace>;
    filletEdge2d(edge1: IEdge, edge2: IEdge, radius: number): Result<IEdge[]>;
    chamferEdge2d(edge1: IEdge, edge2: IEdge, distance: number): Result<IEdge[]>;
    loft(
        sections: (IVertex | IEdge | IWire)[],
        isSolid: boolean,
        isRuled: boolean,
        continuity: Continuity,
    ): Result<IShape>;
    removeFeature(shape: IShape, faces: IFace[]): Result<IShape>;
    removeFillet(
        shape: IShape,
        faces: IFace[],
    ): Result<{
        shape: IShape;
        newEdges: IEdge[];
    }>;
    removeSubShape(shape: IShape, subShapes: IShape[]): Result<IShape>;
    replaceSubShapes(shape: IShape, oldSubShapes: IShape[], newSubShapes: IShape[]): Result<IShape>;
    curveProjection(curve: IEdge | IWire, targetFace: IFace, vec: XYZ): Result<IShape>;
    simplifyShape(
        shape: IShape,
        removeEdges: boolean,
        removeFaces: boolean,
        keepShapes: IShape[],
        linearTolerance?: number,
        angleTolerance?: number,
    ): Result<IShape>;
}
