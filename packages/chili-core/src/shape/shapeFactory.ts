// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { Result } from "../foundation";
import { Plane, Ray, XYZ, XYZLike } from "../math";
import { ICompound, IEdge, IFace, IShape, ISolid, IVertex, IWire } from "./shape";
import { IShapeConverter } from "./shapeConverter";

export interface IShapeFactory {
    readonly kernelName: string;
    readonly converter: IShapeConverter;
    face(wire: IWire[]): Result<IFace>;
    bezier(points: XYZLike[], weights?: number[]): Result<IEdge>;
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
    fuse(bottom: IShape, top: IShape): Result<IShape>;
    sweep(profile: IShape, path: IWire): Result<IShape>;
    revolve(profile: IShape, axis: Ray, angle: number): Result<IShape>;
    booleanCommon(shape1: IShape, shape2: IShape): Result<IShape>;
    booleanCut(shape1: IShape, shape2: IShape): Result<IShape>;
    booleanFuse(shape1: IShape, shape2: IShape): Result<IShape>;
    combine(shapes: IShape[]): Result<ICompound>;
    makeThickSolidBySimple(shape: IShape, thickness: number): Result<IShape>;
    makeThickSolidByJoin(shape: IShape, closingFaces: IShape[], thickness: number): Result<IShape>;
    fillet(shape: IShape, edges: IEdge[], radius: number): Result<IShape>;
    chamfer(shape: IShape, edges: IEdge[], distance: number): Result<IShape>;
    removeFeature(shape: IShape, faces: IFace[]): Result<IShape>;
    removeSubShape(shape: IShape, subShapes: IShape[]): IShape;
    replaceSubShape(shape: IShape, subShape: IShape, newSubShape: IShape): IShape;
}
