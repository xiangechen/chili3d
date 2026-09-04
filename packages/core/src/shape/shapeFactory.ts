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
    /** output face index (findSubShapes order) -> input face index, -1 = new face */
    faceMap: number[];
    /**
     * output edge index (findSubShapes order) -> input edge index, -1 = new edge.
     * For booleans the input enumerates args edges first, then tools edges.
     */
    edgeMap: number[];
    /**
     * output face index (findSubShapes order) -> input edge index for faces generated
     * from an input edge (a sweep's side faces), -1 = not edge-generated. Lets callers
     * seed side faces with the generating edge's stable id instead of a fragile
     * enumeration-order-scoped one. Absent when the kernel predates this map.
     */
    faceEdgeMap?: number[];
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
