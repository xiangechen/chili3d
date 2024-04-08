// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { Plane, Ray, XYZ } from "../math";
import { ICompound, IEdge, IFace, IShape, ISolid, IVertex, IWire } from "./shape";
import { IShapeConverter } from "./shapeConverter";

export interface IShapeFactory {
    readonly converter: IShapeConverter;
    face(...wire: IWire[]): Result<IFace>;
    point(point: XYZ): Result<IVertex>;
    line(start: XYZ, end: XYZ): Result<IEdge>;
    arc(normal: XYZ, center: XYZ, start: XYZ, angle: number): Result<IEdge>;
    circle(normal: XYZ, center: XYZ, radius: number): Result<IEdge>;
    rect(plane: Plane, dx: number, dy: number): Result<IFace>;
    polygon(...points: XYZ[]): Result<IWire>;
    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
    wire(...edges: IEdge[]): Result<IWire>;
    prism(shape: IShape, vec: XYZ): Result<IShape>;
    fuse(bottom: IShape, top: IShape): Result<IShape>;
    sweep(profile: IShape, path: IWire): Result<IShape>;
    revolve(profile: IShape, axis: Ray, angle: number): Result<IShape>;
    booleanCommon(shape1: IShape, shape2: IShape): Result<IShape>;
    booleanCut(shape1: IShape, shape2: IShape): Result<IShape>;
    booleanFuse(shape1: IShape, shape2: IShape): Result<IShape>;
    combine(...shapes: IShape[]): Result<ICompound>;
}
