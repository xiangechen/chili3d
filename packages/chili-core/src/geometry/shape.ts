// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Ray, XYZ } from "../math";
import { Result } from "../base";
import { ICurve } from "./geometry";
import { IShapeMesh } from "./shapeMesh";
import { ShapeType } from "./shapeType";

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
}

export enum SurfaceType {
    Plane,
    Cylinder,
    Cone,
    Sphere,
    Torus,
    BezierSurface,
    BSplineSurface,
    SurfaceOfRevolution,
    SurfaceOfExtrusion,
    OffsetSurface,
    OtherSurface,
}

export interface IShape {
    get id(): string;
    readonly shapeType: ShapeType;
    mesh(): IShapeMesh;
    toJson(): string;
}

export interface IVertex extends IShape {
    point(): XYZ;
}

export interface IEdge extends IShape {
    intersect(other: IEdge | Ray): XYZ[];
    length(): number;
    asCurve(): Result<ICurve>;
}

export interface IWire extends IShape {
    toFace(): Result<IFace>;
}

export interface IFace extends IShape {}

export interface IShell extends IShape {}

export interface ISolid extends IShape {}

export interface ICompound extends IShape {}

export interface ICompoundSolid extends IShape {}
