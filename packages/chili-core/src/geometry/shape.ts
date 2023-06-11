// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Quaternion, Ray, Matrix4, XYZ } from "../math";
import { Result } from "../base";
import { ICurve } from "./geometry";
import { ShapeType } from "./shapeType";
import { IShapeMeshData } from "./meshData";

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
    readonly shapeType: ShapeType;
    get id(): string;
    get mesh(): IShapeMeshData;
    setMatrix(matrix: Matrix4): void;
    toJson(): string;
    isEqual(other: IShape): boolean;
}

export interface IVertex extends IShape {}

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
