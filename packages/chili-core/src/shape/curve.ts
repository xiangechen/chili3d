// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Plane, XYZ } from "../math";
import { CurveType } from "./shape";

export interface ICurve {
    get curveType(): CurveType;
    parameter(point: XYZ): number;
    firstParameter(): number;
    lastParameter(): number;
    point(parameter: number): XYZ;
    project(point: XYZ): XYZ[];
    isCN(n: number): boolean;
    d0(u: number): XYZ;
    d1(u: number): { point: XYZ; vec: XYZ };
    d2(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ };
    d3(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ; vec3: XYZ };
    dn(u: number, n: number): XYZ;
    nearestPoint(point: XYZ): XYZ;
}

export interface ILine extends ICurve {
    direction: XYZ;
}

export interface IConic extends ICurve {
    plane: Plane;
}

export interface ICircle extends IConic {
    center: XYZ;
    radius: number;
}

export interface IBoundedCurve extends ICurve {
    startPoint(): XYZ;
    endPoint(): XYZ;
}

export interface IBezierCurve extends IBoundedCurve {
    degree(): number;
    weight(index: number): number;
    insertPoleAfter(index: number, point: XYZ, weight: number | undefined): void;
    insertPoleBefore(index: number, point: XYZ, weight: number | undefined): void;
    removePole(index: number): void;
    setPole(index: number, point: XYZ, weight: number | undefined): void;
    setWeight(index: number, weight: number): void;
    nbPoles(): number;
    pole(index: number): XYZ;
    poles(): XYZ[];
}

export interface ITrimmedCurve extends IBoundedCurve {
    basisCurve(): ICurve;
}

export interface IOffsetCurve extends ICurve {
    basisCurve(): ICurve;
    offset(): number;
    direction(): XYZ;
}

export namespace ICurve {
    export function isConic(curve: ICurve): curve is IConic {
        let conic = curve as IConic;
        return conic.plane !== undefined;
    }

    export function isCircle(curve: ICurve): curve is ICircle {
        let circle = curve as ICircle;
        return circle.center !== undefined && circle.radius !== undefined;
    }

    export function isLine(curve: ICurve): curve is ILine {
        let line = curve as ILine;
        return line.direction !== undefined;
    }
}
