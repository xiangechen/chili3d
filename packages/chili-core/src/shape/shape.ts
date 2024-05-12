// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { Matrix4, Ray, XYZ } from "../math";
import { ICurve } from "./curve";
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

export enum Orientation {
    FORWARD,
    REVERSED,
    INTERNAL,
    EXTERNAL,
}

export interface IShape {
    readonly shapeType: ShapeType;
    get id(): string;
    get mesh(): IShapeMeshData;
    matrix: Matrix4;
    /**
     * they share the same TShape with the same Locations and Orientations.
     */
    isEqual(other: IShape): boolean;
    /**
     * they share the same TShape with the same Locations, Orientations may differ.
     */
    isSame(other: IShape): boolean;
    /**
     * they share the same TShape. Locations and Orientations may differ.
     */
    isPartner(other: IShape): boolean;
    orientation(): Orientation;
    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[];
    findSubShapes(subshapeType: ShapeType, unique: boolean): IShape[];
    iterSubShapes(shapeType: ShapeType, unique: boolean): IterableIterator<IShape>;
}

export interface IVertex extends IShape {}

export interface IEdge extends IShape {
    intersect(other: IEdge | Ray): XYZ[];
    length(): number;
    asCurve(): Result<ICurve>;
    offset(distance: number, dir: XYZ): Result<IEdge>;
}

export enum JoinType {
    arc,
    tangent,
    intersection,
}

export interface IWire extends IShape {
    toFace(): Result<IFace>;
    offset(distance: number, joinType: JoinType): Result<IShape>;
}

export interface IFace extends IShape {
    normal(u: number, v: number): [point: XYZ, normal: XYZ];
    offset(distance: number, joinType: JoinType): Result<IShape>;
    outerWire(): IWire;
}

export interface IShell extends IShape {}

export interface ISolid extends IShape {}

export interface ICompound extends IShape {}

export interface ICompoundSolid extends IShape {}
