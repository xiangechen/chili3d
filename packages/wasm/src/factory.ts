// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Continuity,
    GeometryUtils,
    type ICompound,
    type ICurve,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeFactory,
    type IShell,
    type ISolid,
    type IVertex,
    type IWire,
    type JoinType,
    type Line,
    MathUtils,
    type OffsetMode,
    type Plane,
    Precision,
    Result,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
    type XYZLike,
} from "@chili3d/core";
import type {
    IntVector,
    RegionsResult,
    ShapeResult,
    ShapesResult,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    TrackedShapeResult,
} from "../lib/chili-wasm";
import { OccCurve } from "./curve";
import { convertFromContinuity, getJoinType, getOffsetMode } from "./helper";
import { OccEdge, OccShape } from "./shape";

function ensureOccShape(shapes: IShape | IShape[]): TopoDS_Shape[] {
    if (Array.isArray(shapes)) {
        return shapes.map((x) => {
            if (!(x instanceof OccShape)) {
                throw new Error("The OCC kernel only supports OCC geometries.");
            }
            return x.shape;
        });
    }

    if (shapes instanceof OccShape) {
        return [shapes.shape];
    }

    throw new Error("The OCC kernel only supports OCC geometries.");
}

function convertShapeResult<P extends unknown[] = unknown[]>(
    factory: (...params: P) => ShapeResult,
    params: P,
    errorString: string,
): Result<IShape, string> {
    let result: ShapeResult;
    try {
        result = factory(...params);
    } catch (err) {
        return Result.err(`${errorString}: ${err}`);
    }

    let res: Result<IShape, string>;
    if (!result.isOk) {
        res = Result.err(result.error);
    } else {
        res = Result.ok(OccShape.wrap(result.shape));
    }

    result.delete();
    return res;
}

function convertShapesResult<P extends unknown[] = unknown[]>(
    factory: (...params: P) => ShapesResult,
    params: P,
    errorString: string,
): Result<IShape[], string> {
    let result: ShapesResult;
    try {
        result = factory(...params);
    } catch {
        return Result.err(errorString);
    }

    let res: Result<IShape[], string>;
    if (!result.isOk) {
        res = Result.err(result.error);
    } else {
        const shapes: IShape[] = [];
        const arr = result.shapes;
        for (let i = 0; i < arr.length; i++) {
            const ts = arr[i];
            if (ts && !ts.isNull()) {
                shapes.push(OccShape.wrap(ts));
            }
        }
        res = Result.ok(shapes);
    }

    result.delete();
    return res;
}

function convertTrackedShapeResult<P extends unknown[] = unknown[]>(
    factory: (...params: P) => TrackedShapeResult,
    params: P,
    errorString: string,
): Result<TrackedShape, string> {
    let result: TrackedShapeResult;
    try {
        result = factory(...params);
    } catch (err) {
        return Result.err(`${errorString}: ${err}`);
    }

    let res: Result<TrackedShape, string>;
    if (!result.isOk) {
        res = Result.err(result.error);
    } else {
        res = Result.ok({
            shape: OccShape.wrap(result.shape),
            faceMap: toIntArray(result.faceMap),
            edgeMap: toIntArray(result.edgeMap),
            faceEdgeMap: toIntArray(result.faceEdgeMap),
            faceAncestors: toIntArray(result.faceAncestors),
            edgeAncestors: toIntArray(result.edgeAncestors),
            capFaces: toIntArray(result.capFaces),
        });
    }

    result.delete();
    return res;
}

function toIntArray(vector: IntVector): number[] {
    const array: number[] = [];
    for (let i = 0; i < vector.size(); i++) {
        array.push(vector.get(i)!);
    }
    vector.delete();
    return array;
}

/** The edges a fillet removal produced, skipping nulls, non-edges and already-seen handles. */
function filletResultEdges(edges: TopoDS_Shape[]): OccEdge[] {
    const newEdges: OccEdge[] = [];
    const visited = new Set();
    for (let i = 0; i < edges.length; i++) {
        const ts = edges[i];
        if (!ts || ts.shapeType() !== wasm.TopAbs_ShapeEnum.TopAbs_EDGE || visited.has(wasm.Shape.ptr(ts)))
            continue;

        newEdges.push(OccShape.wrap(ts) as OccEdge);
    }
    return newEdges;
}

export class ShapeFactory implements IShapeFactory {
    readonly kernelName = "opencascade";

    edge(curve: ICurve): IEdge {
        if (!(curve instanceof OccCurve)) {
            throw new Error("Invalid curve");
        }
        return new OccEdge({ shape: wasm.Edge.fromCurve(curve.curve) });
    }

    fillet(shape: IShape, edges: number[], radius: number): Result<IShape> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertShapeResult(wasm.ShapeFactory.fillet, [shape.shape, edges, radius], "Fillet Error");
        }
        return Result.err("Not OccShape");
    }

    chamfer(shape: IShape, edges: number[], distance: number): Result<IShape> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertShapeResult(
                wasm.ShapeFactory.chamfer,
                [shape.shape, edges, distance],
                "Chamfer Error",
            );
        }
        return Result.err("Not OccShape");
    }

    filletTracked(shape: IShape, edges: number[], radius: number): Result<TrackedShape> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertTrackedShapeResult(
                wasm.ShapeFactory.filletTracked,
                [shape.shape, edges, radius],
                "Fillet Error",
            );
        }
        return Result.err("Not OccShape");
    }

    chamferTracked(shape: IShape, edges: number[], distance: number): Result<TrackedShape> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertTrackedShapeResult(
                wasm.ShapeFactory.chamferTracked,
                [shape.shape, edges, distance],
                "Chamfer Error",
            );
        }
        return Result.err("Not OccShape");
    }

    fillet2d(face: IFace, edge1: IEdge, edge2: IEdge, radius: number): Result<IFace> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        const [occFace, occEdge1, occEdge2] = ensureOccShape([face, edge1, edge2]);
        return convertShapeResult(
            wasm.ShapeFactory.fillet2d,
            [occFace as TopoDS_Face, occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, radius],
            "Fillet2d Error",
        ) as Result<IFace>;
    }

    filletEdge2d(edge1: IEdge, edge2: IEdge, radius: number): Result<IEdge[]> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        const [occEdge1, occEdge2] = ensureOccShape([edge1, edge2]);
        return convertShapesResult(
            wasm.ShapeFactory.filletEdge2d,
            [occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, radius],
            "FilletEdge2d Error",
        ) as Result<IEdge[]>;
    }

    chamfer2d(face: IFace, edge1: IEdge, edge2: IEdge, distance: number): Result<IFace> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        const [occFace, occEdge1, occEdge2] = ensureOccShape([face, edge1, edge2]);
        return convertShapeResult(
            wasm.ShapeFactory.chamfer2d,
            [occFace as TopoDS_Face, occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, distance],
            "Chamfer2d Error",
        ) as Result<IFace>;
    }

    chamferEdge2d(edge1: IEdge, edge2: IEdge, distance: number): Result<IEdge[]> {
        if (distance < Precision.Distance) {
            return Result.err("The distance is too small.");
        }

        const [occEdge1, occEdge2] = ensureOccShape([edge1, edge2]);
        return convertShapesResult(
            wasm.ShapeFactory.chamferEdge2d,
            [occEdge1 as TopoDS_Edge, occEdge2 as TopoDS_Edge, distance],
            "ChamferEdge2d Error",
        ) as Result<IEdge[]>;
    }

    removeFeature(shape: IShape, faces: IFace[]): Result<IShape> {
        if (!(shape instanceof OccShape)) {
            return Result.err("Not OccShape");
        }
        const occFaces = ensureOccShape(faces);
        const result = wasm.ShapeFactory.removeFeature(shape.shape, occFaces);
        if (!result.isOk) {
            return Result.err(result.error);
        }
        if (result.shape.isNull() || shape.shape.isEqual(result.shape)) {
            return Result.err("Can not remove feature");
        }
        return Result.ok(OccShape.wrap(result.shape));
    }

    removeFillet(shape: IShape, faces: IFace[]) {
        if (!(shape instanceof OccShape)) {
            return Result.err("Not OccShape");
        }
        const occFaces = ensureOccShape(faces);
        const result = wasm.ShapeFactory.removeFillet(shape.shape, occFaces);
        if (!result.isOk) {
            return Result.err(result.error);
        }
        if (result.shape.isNull() || shape.shape.isEqual(result.shape)) {
            return Result.err("Can not remove fillet");
        }

        return Result.ok({
            shape: OccShape.wrap(result.shape),
            newEdges: filletResultEdges(result.newEdges),
        });
    }

    removeSubShape(shape: IShape, subShapes: IShape[]): Result<IShape> {
        const occShape = ensureOccShape(shape);
        const occSubShapes = ensureOccShape(subShapes);
        return convertShapeResult(
            wasm.ShapeFactory.removeSubShape,
            [occShape[0], occSubShapes],
            "Remove SubShape Error",
        );
    }

    replaceSubShapes(shape: IShape, oldSubShapes: IShape[], newSubShapes: IShape[]): Result<IShape> {
        const occShape = ensureOccShape(shape);
        const occOld = ensureOccShape(oldSubShapes);
        const occNew = ensureOccShape(newSubShapes);
        return convertShapeResult(
            wasm.ShapeFactory.replaceSubShapes,
            [occShape[0], occOld, occNew],
            "Replace SubShapes Error",
        );
    }

    face(wire: IWire[]): Result<IFace> {
        if (wire.length === 0) {
            return Result.err("The wire is empty.");
        }
        const normal = GeometryUtils.normal(wire[0]);
        for (let i = 1; i < wire.length; i++) {
            if (GeometryUtils.isCCW(normal, wire[i])) {
                wire[i].reserve();
            }
        }
        const shapes = ensureOccShape(wire);
        return convertShapeResult(wasm.ShapeFactory.face, [shapes], "Face Error") as Result<IFace>;
    }
    faceFromSurface(wires: IWire[], sourceFace: IFace): Result<IFace> {
        if (wires.length === 0) {
            return Result.err("The wire is empty.");
        }
        const normal = GeometryUtils.normal(wires[0]);
        for (let i = 1; i < wires.length; i++) {
            if (GeometryUtils.isCCW(normal, wires[i])) {
                wires[i].reserve();
            }
        }
        const shapes = ensureOccShape(wires);
        const [occFace] = ensureOccShape(sourceFace);
        return convertShapeResult(
            wasm.ShapeFactory.faceFromSurface,
            [shapes, occFace],
            "FaceFromSurface Error",
        ) as Result<IFace>;
    }
    facesFromEdges(edges: IEdge[], plane: Plane): Result<{ faces: IFace[]; sources: number[][] }> {
        if (edges.length === 0) {
            return Result.err("The edges are empty.");
        }
        const occEdges = ensureOccShape(edges);
        let result: RegionsResult;
        try {
            result = wasm.ShapeFactory.facesFromEdges(occEdges, {
                location: plane.origin,
                direction: plane.normal,
                xDirection: plane.xvec,
            });
        } catch (err) {
            return Result.err(`FacesFromEdges Error: ${err}`);
        }

        let res: Result<{ faces: IFace[]; sources: number[][] }, string>;
        if (!result.isOk) {
            res = Result.err(result.error);
        } else {
            const faces: IFace[] = [];
            for (let i = 0; i < result.faces.length; i++) {
                faces.push(OccShape.wrap(result.faces[i]) as IFace);
            }
            // sourceIds is flattened: region k owns sourceIds[sum(counts<k) .. +counts[k]].
            const counts = toIntArray(result.sourceCounts);
            const ids = toIntArray(result.sourceIds);
            const sources: number[][] = [];
            let offset = 0;
            for (const count of counts) {
                sources.push(ids.slice(offset, offset + count));
                offset += count;
            }
            res = Result.ok({ faces, sources });
        }
        result.delete();
        return res;
    }
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.bezier,
            [points, weights ?? []],
            "Bezier Error",
        ) as Result<IEdge>;
    }
    helix(
        origin: XYZLike,
        normal: XYZLike,
        xDir: XYZLike,
        radius: number,
        pitch: number,
        angle: number,
    ): Result<IWire> {
        return convertShapeResult(
            wasm.ShapeFactory.helix,
            [origin, normal, xDir, radius, pitch, MathUtils.degToRad(angle)],
            "Helix Error",
        ) as Result<IWire>;
    }
    point(point: XYZLike): Result<IVertex> {
        return convertShapeResult(wasm.ShapeFactory.point, [point], "Point Error") as Result<IVertex>;
    }
    line(start: XYZLike, end: XYZLike): Result<IEdge> {
        if (MathUtils.allEqualZero(start.x - end.x, start.y - end.y, start.z - end.z)) {
            return Result.err("The start and end points are too close.");
        }

        return convertShapeResult(wasm.ShapeFactory.line, [start, end], "Line Error") as Result<IEdge>;
    }
    arc(normal: XYZLike, center: XYZLike, start: XYZLike, angle: number): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.arc,
            [normal, center, start, MathUtils.degToRad(angle)],
            "Arc Error",
        ) as Result<IEdge>;
    }
    circle(normal: XYZLike, center: XYZLike, radius: number): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.circle,
            [normal, center, radius],
            "Circle Error",
        ) as Result<IEdge>;
    }
    rect(plane: Plane, dx: number, dy: number): Result<IFace> {
        return convertShapeResult(
            wasm.ShapeFactory.rect,
            [
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
            ],
            "Rect Error",
        ) as Result<IFace>;
    }
    polygon(points: XYZLike[]): Result<IWire> {
        return convertShapeResult(wasm.ShapeFactory.polygon, [points], "Polygon Error") as Result<IWire>;
    }
    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.box,
            [
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
                dz,
            ],
            "Box Error",
        ) as Result<ISolid>;
    }
    cylinder(dir: XYZ, center: XYZ, radius: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.cylinder,
            [dir, center, radius, dz],
            "Cylinder Error",
        ) as Result<ISolid>;
    }
    cone(dir: XYZ, center: XYZ, radius: number, radiusUp: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.cone,
            [dir, center, radius, radiusUp, dz],
            "Cone Error",
        ) as Result<ISolid>;
    }
    sphere(center: XYZ, radius: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.sphere,
            [center, radius],
            "Sphere Error",
        ) as Result<ISolid>;
    }
    ellipse(
        normal: XYZLike,
        center: XYZLike,
        xvec: XYZLike,
        majorRadius: number,
        minorRadius: number,
    ): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.ellipse,
            [normal, center, xvec, majorRadius, minorRadius],
            "Ellipse Error",
        ) as Result<IEdge>;
    }
    pyramid(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.pyramid,
            [
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
                dz,
            ],
            "Pyramid Error",
        ) as Result<ISolid>;
    }
    wire(edges: IEdge[]): Result<IWire> {
        return convertShapeResult(
            wasm.ShapeFactory.wire,
            [ensureOccShape(edges)],
            "Wire Error",
        ) as Result<IWire>;
    }
    shell(faces: IFace[]): Result<IShell> {
        return convertShapeResult(
            wasm.ShapeFactory.shell,
            [ensureOccShape(faces)],
            "Shell Error",
        ) as Result<IShell>;
    }
    solid(shells: IShell[]): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.solid,
            [ensureOccShape(shells)],
            "Solid Error",
        ) as Result<ISolid>;
    }
    prism(shape: IShape, vec: XYZ): Result<IShape> {
        if (vec.length() === 0) {
            return Result.err(`The vector length is 0, the prism cannot be created.`);
        }
        return convertShapeResult(wasm.ShapeFactory.prism, [ensureOccShape(shape)[0], vec], "Prism Error");
    }

    prismTracked(shape: IShape, vec: XYZ): Result<TrackedShape> {
        if (vec.length() === 0) {
            return Result.err(`The vector length is 0, the prism cannot be created.`);
        }
        return convertTrackedShapeResult(
            wasm.ShapeFactory.prismTracked,
            [ensureOccShape(shape)[0], vec],
            "Prism Error",
        );
    }
    pushPull(shape: IShape, face: IShape, vec: XYZ): Result<IShape> {
        if (vec.length() === 0) {
            return Result.err(`The vector length is 0, the prism cannot be created.`);
        }
        return convertShapeResult(
            wasm.ShapeFactory.pushPull,
            [ensureOccShape(shape)[0], ensureOccShape(face)[0], vec],
            "PushPull Error",
        );
    }
    fuse(bottom: IShape, top: IShape): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanFuse,
            [ensureOccShape(bottom), ensureOccShape(top)],
            "Fuse Error",
        );
    }
    sweep(profile: IShape[], path: IWire, isRound: boolean): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.sweep,
            [ensureOccShape(profile), ensureOccShape(path)[0], true, isRound],
            "Sweep Error",
        );
    }
    revolve(profile: IShape, axis: Line, angle: number): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.revolve,
            [
                ensureOccShape(profile)[0],
                {
                    location: axis.point,
                    direction: axis.direction,
                },
                MathUtils.degToRad(angle),
            ],
            "Revolve Error",
        );
    }

    revolveTracked(profile: IShape, axis: Line, angle: number): Result<TrackedShape> {
        return convertTrackedShapeResult(
            wasm.ShapeFactory.revolveTracked,
            [
                ensureOccShape(profile)[0],
                {
                    location: axis.point,
                    direction: axis.direction,
                },
                MathUtils.degToRad(angle),
            ],
            "Revolve Error",
        );
    }
    booleanCommon(shape1: IShape[], shape2: IShape[]): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanCommon,
            [ensureOccShape(shape1), ensureOccShape(shape2)],
            "BooleanCommon Error",
        );
    }
    booleanCut(shape1: IShape[], shape2: IShape[]): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanCut,
            [ensureOccShape(shape1), ensureOccShape(shape2)],
            "BooleanCut Error",
        );
    }

    booleanCommonTracked(shape1: IShape[], shape2: IShape[]): Result<TrackedShape> {
        return convertTrackedShapeResult(
            wasm.ShapeFactory.booleanCommonTracked,
            [ensureOccShape(shape1), ensureOccShape(shape2)],
            "BooleanCommon Error",
        );
    }

    booleanCutTracked(shape1: IShape[], shape2: IShape[]): Result<TrackedShape> {
        return convertTrackedShapeResult(
            wasm.ShapeFactory.booleanCutTracked,
            [ensureOccShape(shape1), ensureOccShape(shape2)],
            "BooleanCut Error",
        );
    }

    booleanFuseTracked(shape1: IShape[], shape2: IShape[]): Result<TrackedShape> {
        return convertTrackedShapeResult(
            wasm.ShapeFactory.booleanFuseTracked,
            [ensureOccShape(shape1), ensureOccShape(shape2)],
            "BooleanFuse Error",
        );
    }
    booleanFuse(shape1: IShape[], shape2: IShape[], simplifyShape: boolean): Result<IShape> {
        const occShape1 = ensureOccShape(shape1);
        const occShape2 = ensureOccShape(shape2);

        const fused = convertShapeResult(
            wasm.ShapeFactory.booleanFuse,
            [occShape1, occShape2],
            "BooleanFuse Error",
        );

        if (!fused.isOk || !simplifyShape) {
            return fused;
        }

        const occShape = fused.value as OccShape;
        const simplified = convertShapeResult(
            wasm.ShapeFactory.simplifyShape,
            [occShape.shape, true, true, [], 1e-5, 1e-6],
            "SimplifyShape Error",
        );
        if (!simplified.isOk) {
            return fused;
        }
        return simplified;
    }
    sewing(shapes: IShape[]): Result<IShape> {
        const occShapes = ensureOccShape(shapes);
        return convertShapeResult(wasm.ShapeFactory.sewing, [occShapes], "Sewing Error");
    }
    combine(shapes: IShape[]): Result<ICompound> {
        return convertShapeResult(
            wasm.ShapeFactory.combine,
            [ensureOccShape(shapes)],
            "Combine Error",
        ) as Result<ICompound>;
    }
    makeThickSolidBySimple(shape: IShape, thickness: number): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.makeThickSolidBySimple,
            [ensureOccShape(shape)[0], thickness],
            "MakeThickSolidBySimple Error",
        );
    }
    makeThickSolidByJoin(
        shape: IShape,
        closingFaces: IShape[],
        thickness: number,
        joinType: JoinType,
        mode: OffsetMode = "skin",
        intersection: boolean = false,
    ): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.makeThickSolidByJoin,
            [
                ensureOccShape(shape)[0],
                ensureOccShape(closingFaces),
                thickness,
                getJoinType(joinType),
                getOffsetMode(mode),
                intersection,
            ],
            "MakeThickSolidByJoin Error",
        );
    }
    loft(
        sections: (IVertex | IEdge | IWire)[],
        isSolid: boolean,
        isRuled: boolean,
        continuity: Continuity,
    ): Result<IShape> {
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section.shapeType === ShapeTypes.edge) {
                sections[i] = this.wire([section as IEdge]).value;
            }
        }
        return convertShapeResult(
            wasm.ShapeFactory.loft,
            [ensureOccShape(sections), isSolid, isRuled, convertFromContinuity(continuity)],
            "Loft Error",
        );
    }
    curveProjection(curve: IEdge | IWire, targetFace: IFace, vec: XYZ): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.curveProjection,
            [ensureOccShape(curve)[0], ensureOccShape(targetFace)[0], new wasm.gp_Dir(vec.x, vec.y, vec.z)],
            "CurveProjection Error",
        );
    }
    simplifyShape(
        shape: IShape,
        removeEdges: boolean,
        removeFaces: boolean,
        keepShapes: IShape[],
        linearTolerance: number = 1e-5,
        angleTolerance: number = 1e-6,
    ): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.simplifyShape,
            [
                ensureOccShape(shape)[0],
                removeEdges,
                removeFaces,
                ensureOccShape(keepShapes),
                linearTolerance,
                angleTolerance,
            ],
            "SimplifyShape Error",
        );
    }
}
