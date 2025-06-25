// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ICompound,
    IEdge,
    IFace,
    IShape,
    IShapeConverter,
    IShapeFactory,
    IShell,
    ISolid,
    IVertex,
    IWire,
    MathUtils,
    Plane,
    Precision,
    Ray,
    Result,
    XYZ,
    XYZLike,
} from "chili-core";
import { ShapeResult, TopoDS_Shape } from "../lib/chili-wasm";
import { OccShapeConverter } from "./converter";
import { OcctHelper } from "./helper";
import { OccShape } from "./shape";

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

function convertShapeResult(result: ShapeResult): Result<IShape, string> {
    let res: Result<IShape, string>;
    if (!result.isOk) {
        res = Result.err(result.error);
    } else if (result.shape.isNull()) {
        res = Result.err("The shape is null.");
    } else {
        res = Result.ok(OcctHelper.wrapShape(result.shape));
    }

    result.delete();
    return res;
}

export class ShapeFactory implements IShapeFactory {
    readonly kernelName = "opencascade";
    readonly converter: IShapeConverter;

    constructor() {
        this.converter = new OccShapeConverter();
    }

    fillet(shape: IShape, edges: number[], radius: number): Result<IShape> {
        if (radius < Precision.Distance) {
            return Result.err("The radius is too small.");
        }

        if (edges.length === 0) {
            return Result.err("The edges is empty.");
        }

        if (shape instanceof OccShape) {
            return convertShapeResult(wasm.ShapeFactory.fillet(shape.shape, edges, radius));
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
            return convertShapeResult(wasm.ShapeFactory.chamfer(shape.shape, edges, distance));
        }
        return Result.err("Not OccShape");
    }

    removeFeature(shape: IShape, faces: IFace[]): Result<IShape> {
        if (!(shape instanceof OccShape)) {
            return Result.err("Not OccShape");
        }
        let occFaces = faces.map((x) => {
            if (!(x instanceof OccShape)) {
                throw new Error("The OCC kernel only supports OCC geometries.");
            }
            if (x.shape.isNull()) {
                throw new Error("The shape is null.");
            }
            return x.shape;
        });
        const removed = wasm.Shape.removeFeature(shape.shape, occFaces);
        if (removed.isNull()) {
            return Result.err("Can not remove");
        }
        return Result.ok(OcctHelper.wrapShape(removed));
    }

    removeSubShape(shape: IShape, subShapes: IShape[]): IShape {
        const occShape = ensureOccShape(shape);
        const occSubShapes = ensureOccShape(subShapes);
        return OcctHelper.wrapShape(wasm.Shape.removeSubShape(occShape[0], occSubShapes));
    }

    replaceSubShape(shape: IShape, subShape: IShape, newSubShape: IShape): IShape {
        const [occShape, occSubShape, occNewSubShape] = ensureOccShape([shape, subShape, newSubShape]);
        return OcctHelper.wrapShape(wasm.Shape.replaceSubShape(occShape, occSubShape, occNewSubShape));
    }

    face(wire: IWire[]): Result<IFace> {
        let shapes = ensureOccShape(wire);
        return convertShapeResult(wasm.ShapeFactory.face(shapes)) as Result<IFace>;
    }
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge> {
        return convertShapeResult(wasm.ShapeFactory.bezier(points, weights ?? [])) as Result<IEdge>;
    }
    point(point: XYZLike): Result<IVertex> {
        return convertShapeResult(wasm.ShapeFactory.point(point)) as Result<IVertex>;
    }
    line(start: XYZLike, end: XYZLike): Result<IEdge> {
        if (MathUtils.allEqualZero(start.x - end.x, start.y - end.y, start.z - end.z)) {
            return Result.err("The start and end points are too close.");
        }

        return convertShapeResult(wasm.ShapeFactory.line(start, end)) as Result<IEdge>;
    }
    arc(normal: XYZLike, center: XYZLike, start: XYZLike, angle: number): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.arc(normal, center, start, MathUtils.degToRad(angle)),
        ) as Result<IEdge>;
    }
    circle(normal: XYZLike, center: XYZLike, radius: number): Result<IEdge> {
        return convertShapeResult(wasm.ShapeFactory.circle(normal, center, radius)) as Result<IEdge>;
    }
    rect(plane: Plane, dx: number, dy: number): Result<IFace> {
        return convertShapeResult(
            wasm.ShapeFactory.rect(
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
            ),
        ) as Result<IFace>;
    }
    polygon(points: XYZLike[]): Result<IWire> {
        return convertShapeResult(wasm.ShapeFactory.polygon(points)) as Result<IWire>;
    }
    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.box(
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
                dz,
            ),
        ) as Result<ISolid>;
    }
    cylinder(dir: XYZ, center: XYZ, radius: number, dz: number): Result<ISolid> {
        return convertShapeResult(wasm.ShapeFactory.cylinder(dir, center, radius, dz)) as Result<ISolid>;
    }
    cone(dir: XYZ, center: XYZ, radius: number, radiusUp: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.cone(dir, center, radius, radiusUp, dz),
        ) as Result<ISolid>;
    }
    sphere(center: XYZ, radius: number): Result<ISolid> {
        return convertShapeResult(wasm.ShapeFactory.sphere(center, radius)) as Result<ISolid>;
    }
    ellipse(
        normal: XYZLike,
        center: XYZLike,
        xvec: XYZLike,
        majorRadius: number,
        minorRadius: number,
    ): Result<IEdge> {
        return convertShapeResult(
            wasm.ShapeFactory.ellipse(normal, center, xvec, majorRadius, minorRadius),
        ) as Result<IEdge>;
    }
    pyramid(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid> {
        return convertShapeResult(
            wasm.ShapeFactory.pyramid(
                {
                    location: plane.origin,
                    direction: plane.normal,
                    xDirection: plane.xvec,
                },
                dx,
                dy,
                dz,
            ),
        ) as Result<ISolid>;
    }
    wire(edges: IEdge[]): Result<IWire> {
        return convertShapeResult(wasm.ShapeFactory.wire(ensureOccShape(edges))) as Result<IWire>;
    }
    shell(faces: IFace[]): Result<IShell> {
        return convertShapeResult(wasm.ShapeFactory.shell(ensureOccShape(faces))) as Result<IShell>;
    }
    solid(shells: IShell[]): Result<ISolid> {
        return convertShapeResult(wasm.ShapeFactory.solid(ensureOccShape(shells))) as Result<ISolid>;
    }
    prism(shape: IShape, vec: XYZ): Result<IShape> {
        if (vec.length() === 0) {
            return Result.err(`The vector length is 0, the prism cannot be created.`);
        }
        return convertShapeResult(wasm.ShapeFactory.prism(ensureOccShape(shape)[0], vec));
    }
    fuse(bottom: IShape, top: IShape): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanFuse(ensureOccShape(bottom), ensureOccShape(top)),
        );
    }
    sweep(profile: IShape[], path: IWire, isRound: boolean): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.sweep(ensureOccShape(profile), ensureOccShape(path)[0], true, isRound),
        );
    }
    revolve(profile: IShape, axis: Ray, angle: number): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.revolve(
                ensureOccShape(profile)[0],
                {
                    location: axis.location,
                    direction: axis.direction,
                },
                MathUtils.degToRad(angle),
            ),
        );
    }
    booleanCommon(shape1: IShape[], shape2: IShape[]): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanCommon(ensureOccShape(shape1), ensureOccShape(shape2)),
        );
    }
    booleanCut(shape1: IShape[], shape2: IShape[]): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanCut(ensureOccShape(shape1), ensureOccShape(shape2)),
        );
    }
    booleanFuse(shape1: IShape[], shape2: IShape[]): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.booleanFuse(ensureOccShape(shape1), ensureOccShape(shape2)),
        );
    }
    combine(shapes: IShape[]): Result<ICompound> {
        return convertShapeResult(wasm.ShapeFactory.combine(ensureOccShape(shapes))) as Result<ICompound>;
    }
    makeThickSolidBySimple(shape: IShape, thickness: number): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.makeThickSolidBySimple(ensureOccShape(shape)[0], thickness),
        );
    }
    makeThickSolidByJoin(shape: IShape, closingFaces: IShape[], thickness: number): Result<IShape> {
        return convertShapeResult(
            wasm.ShapeFactory.makeThickSolidByJoin(
                ensureOccShape(shape)[0],
                ensureOccShape(closingFaces),
                thickness,
            ),
        );
    }
}
