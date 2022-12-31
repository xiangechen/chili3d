// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XY, XYZ } from "chili-shared";
import { CurveType } from "./shape";

export interface ICurve {
    get curveType(): CurveType;
    firstParameter(): number;
    lastParameter(): number;
    point(parameter: number): XYZ;
    trim(start: number, end: number): void;
    project(point: XYZ): XYZ[];
}

export interface ILine extends ICurve {
    get startPoint(): XYZ;
    get endPoint(): XYZ;

    get direction(): XYZ;
    set direction(value: XYZ);

    get location(): XYZ;
    set location(value: XYZ);
}

export interface ICircle extends ICurve {
    get center(): XYZ;
    set center(value: XYZ);
    get radius(): number;
    set radius(value: number);
}
