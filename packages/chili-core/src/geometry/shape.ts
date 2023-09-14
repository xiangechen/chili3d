// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../base";
import { Matrix4, Ray, XYZ } from "../math";
import { ISerialize } from "../serialize";
import { ICurve } from "./geometry";
import { IShapeMeshData } from "./meshData";
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

export interface IShape extends ISerialize {
    readonly shapeType: ShapeType;
    get id(): string;
    get mesh(): IShapeMeshData;
    setMatrix(matrix: Matrix4): void;
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

export interface IFace extends IShape {
    normal(u: number, v: number): [point: XYZ, normal: XYZ];
}

export interface IShell extends IShape {}

export interface ISolid extends IShape {}

export interface ICompound extends IShape {}

export interface ICompoundSolid extends IShape {}
