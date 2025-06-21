// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, XYZ } from "../math";
import { Continuity, ICurve } from "./curve";
import { IGeometry } from "./geometry";

export enum SurfaceType {
    Plate,
    Bezier,
    BSpline,
    RectangularTrimmed,
    Conical,
    Cylinder,
    Plane,
    Spherical,
    Toroidal,
    Revolution,
    Extrusion,
    Offset,
    Composite,
}

export interface ISurface extends IGeometry {
    nearestPoint(point: XYZ): [XYZ, number] | undefined;
    project(point: XYZ): XYZ[];
    projectCurve(curve: ICurve): ICurve | undefined;
    parameter(point: XYZ, maxDistance: number): { u: number; v: number } | undefined;
    continuity(): Continuity;
    uIso(u: number): ICurve;
    vIso(v: number): ICurve;
    isPlanar(): boolean;
    isUClosed(): boolean;
    isVClosed(): boolean;
    isUPreiodic(): boolean;
    isVPreiodic(): boolean;
    vPeriod(): number;
    uPeriod(): number;
    bounds(): {
        u1: number;
        u2: number;
        v1: number;
        v2: number;
    };
    isCNu(n: number): boolean;
    isCNv(n: number): boolean;
    d0(u: number, v: number): XYZ;
    d1(
        u: number,
        v: number,
    ): {
        point: XYZ;
        d1u: XYZ;
        d1v: XYZ;
    };
    d2(
        u: number,
        v: number,
    ): {
        point: XYZ;
        d1u: XYZ;
        d1v: XYZ;
        d2u: XYZ;
        d2v: XYZ;
        d2uv: XYZ;
    };
    d3(
        u: number,
        v: number,
    ): {
        point: XYZ;
        d1u: XYZ;
        d1v: XYZ;
        d2u: XYZ;
        d2v: XYZ;
        d2uv: XYZ;
        d3u: XYZ;
        d3v: XYZ;
        d3uuv: XYZ;
        d3uvv: XYZ;
    };
    dn(u: number, v: number, nu: number, nv: number): XYZ;
    value(u: number, v: number): XYZ;
}

export interface IPlateSurface extends ISurface {
    setBounds(u1: number, u2: number, v1: number, v2: number): void;
}

export interface IBoundedSurface extends ISurface {}

export interface IElementarySurface extends ISurface {
    axis: XYZ;
    coordinates: Plane;
    location: XYZ;
}

export interface IOffsetSurface extends ISurface {
    offset: number;
    basisSurface: ISurface;
}

export interface ISweptSurface extends ISurface {
    direction(): XYZ;
    basisCurve(): ICurve;
}

export interface ICompositeSurface extends ISurface {}

export interface IBSplineSurface extends IBoundedSurface {}

export interface IBezierSurface extends IBoundedSurface {}

export interface IRectangularTrimmedSurface extends IBoundedSurface {
    basisSurface(): ISurface;
    setUTrim(u1: number, u2: number): void;
    setVTrim(v1: number, v2: number): void;
    setTrim(u1: number, u2: number, v1: number, v2: number): void;
}

export interface IConicalSurface extends IElementarySurface {
    semiAngle: number;
    setRadius(value: number): void;
    apex(): XYZ;
    refRadius(): number;
}

export interface ICylindricalSurface extends IElementarySurface {
    radius: number;
}

export interface IPlaneSurface extends IElementarySurface {
    plane: Plane;
}

export interface ISphericalSurface extends IElementarySurface {
    radius: number;
    area(): number;
    volume(): number;
}

export interface IToroidalSurface extends IElementarySurface {
    area(): number;
    volume(): number;
    majorRadius: number;
    minorRadius: number;
}

export interface ISurfaceOfLinearExtrusion extends ISweptSurface {}

export interface ISurfaceOfRevolution extends ISweptSurface {
    location: XYZ;
    referencePlane(): Plane;
}
