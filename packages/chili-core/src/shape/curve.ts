// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Ray, XYZ } from "../math";
import { IGeometry } from "./geometry";
import { IEdge } from "./shape";

export enum CurveType {
    Line,
    Circle,
    Ellipse,
    Hyperbola,
    Parabola,
    BezierCurve,
    BSplineCurve,
    OffsetCurve,
    OtherCurve,
    TrimmedCurve,
}

export enum Continuity {
    C0,
    G1,
    C1,
    G2,
    C2,
    C3,
    CN,
}

export interface ICurve extends IGeometry {
    get curveType(): CurveType;
    uniformAbscissaByLength(length: number): XYZ[];
    uniformAbscissaByCount(curveCount: number): XYZ[];
    length(): number;
    parameter(point: XYZ, tolerance: number): number | undefined;
    firstParameter(): number;
    lastParameter(): number;
    project(point: XYZ): XYZ[];
    value(parameter: number): XYZ;
    isCN(n: number): boolean;
    trim(u1: number, u2: number): ITrimmedCurve;
    d0(u: number): XYZ;
    d1(u: number): { point: XYZ; vec: XYZ };
    d2(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ };
    d3(u: number): { point: XYZ; vec1: XYZ; vec2: XYZ; vec3: XYZ };
    dn(u: number, n: number): XYZ;
    reverse(): void;
    reversed(): ICurve;
    nearestFromPoint(point: XYZ): {
        point: XYZ;
        parameter: number;
        distance: number;
    };
    nearestExtrema(curve: ICurve | Ray):
        | undefined
        | {
              isParallel: boolean;
              distance: number;
              p1: XYZ;
              p2: XYZ;
              u1: number;
              u2: number;
          };
    isClosed(): boolean;
    period(): number;
    isPeriodic(): boolean;
    continutity(): Continuity;
    makeEdge(): IEdge;
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
    insertPoleAfter(index: number, point: XYZ, weight?: number): void;
    insertPoleBefore(index: number, point: XYZ, weight?: number): void;
    removePole(index: number): void;
    setPole(index: number, point: XYZ, weight?: number): void;
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
    get basisCurve(): ICurve;
    setTrim(u1: number, u2: number): void;
}

export interface IOffsetCurve extends ICurve {
    get basisCurve(): ICurve;
    offset(): number;
    direction(): XYZ;
}

export interface IComplexCurve {
    nbCurves(): number;
    curve(index: number): ICurve;
}

export namespace ICurve {
    export function isConic(curve: ICurve): curve is IConic {
        return (curve as IConic).axis !== undefined;
    }

    export function isCircle(curve: ICurve): curve is ICircle {
        let circle = curve as ICircle;
        return circle.center !== undefined && circle.radius !== undefined;
    }

    export function isLine(curve: ICurve): curve is ILine {
        return (curve as ILine).direction !== undefined;
    }

    export function isTrimmed(curve: ICurve): curve is ITrimmedCurve {
        return (curve as ITrimmedCurve).basisCurve !== undefined;
    }
}
