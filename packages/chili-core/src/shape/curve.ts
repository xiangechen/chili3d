// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { XYZ } from "../math";
import { CurveType } from "./shape";

export enum Continuity {
    C0,
    G1,
    C1,
    G2,
    C2,
    C3,
    CN,
}

export interface ICurve {
    get curveType(): CurveType;
    parameter(point: XYZ): number;
    firstParameter(): number;
    lastParameter(): number;
    project(point: XYZ): XYZ[];
    value(parameter: number): XYZ;
    isCN(n: number): boolean;
    d0(u: number): XYZ;
    d1(u: number): { point: XYZ; vec: XYZ };
    d2(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ };
    d3(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ; vec3: XYZ };
    dn(u: number, n: number): XYZ;
    reversed(): ICurve;
    nearestPoint(point: XYZ): XYZ;
    isClosed(): boolean;
    period(): number;
    isPeriodic(): boolean;
    continutity(): Continuity;
}

export interface ILine extends ICurve {
    direction: XYZ;
}

export interface IConic extends ICurve {
    axis: XYZ;
    xAxis: XYZ;
    yAxis: XYZ;
    eccentricity(): number;
}

export interface ICircle extends IConic {
    center: XYZ;
    radius: number;
}

export interface IEllipse extends IConic {
    area(): number;
    center: XYZ;
    get focus1(): XYZ;
    get focus2(): XYZ;
    majorRadius: number;
    minorRadius: number;
}

export interface IHyperbola extends IConic {
    focal(): number;
    location: XYZ;
    get focus1(): XYZ;
    get focus2(): XYZ;
    majorRadius: number;
    minorRadius: number;
}

export interface IParabola extends IConic {
    focal(): number;
    get focus(): XYZ;
    get directrix(): XYZ;
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

export interface IBSplineCurve extends IBoundedCurve {
    degree(): number;
    nbKnots(): number;
    knot(index: number): number;
    setKnot(index: number, value: number): void;
    nbPoles(): number;
    pole(index: number): XYZ;
    poles(): XYZ[];
    weight(index: number): number;
    setWeight(index: number, value: number): void;
}

export interface ITrimmedCurve extends IBoundedCurve {
    basisCurve(): ICurve;
}

export interface IOffsetCurve extends ICurve {
    basisCurve(): ICurve;
    offset(): number;
    direction(): XYZ;
}

export interface IComplexCurve {
    nbCurves(): number;
    curve(index: number): ICurve;
}

export namespace ICurve {
    export function isConic(curve: ICurve): curve is IConic {
        let conic = curve as IConic;
        return conic.axis !== undefined;
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
