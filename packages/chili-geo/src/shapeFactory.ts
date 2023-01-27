// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEdge, IFace, ISolid, IVertex, IWire, Plane, Result, XYZ } from "chili-core";

export interface IShapeFactory {
    point(point: XYZ): Result<IVertex>;
    line(start: XYZ, end: XYZ): Result<IEdge>;
    circle(normal: XYZ, center: XYZ, radius: number): Result<IEdge>;
    rect(plane: Plane, dx: number, dy: number): Result<IFace>;
    polygon(...points: XYZ[]): Result<IWire>;
    box(plane: Plane, dx: number, dy: number, dz: number): Result<ISolid>;
}
