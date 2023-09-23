// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IEdge,
    IFace,
    IShape,
    IShapeConverter,
    ISolid,
    IVertex,
    IWire,
    Plane,
    Ray,
    Result,
    XYZ,
} from "chili-core";

export interface IShapeFactory {
    readonly converter: IShapeConverter;
    point(point: XYZ): Result<IVertex>;
    line(start: XYZ, end: XYZ): Result<IEdge>;
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
}
