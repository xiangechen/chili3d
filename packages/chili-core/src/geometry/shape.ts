// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Quaternion, Ray, Transform, XYZ } from "../math";
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
    setTranslation(offset: XYZ): void;
    setScale(scale: XYZ, value: number): void;
    setRotation(rotation: Quaternion): void;
    mesh(): IShapeMesh;
    toJson(): string;
    isEqual(other: IShape): boolean;
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
    readonly edges: ReadonlyArray<IEdge>;
    toFace(): Result<IFace>;
}

export interface IFace extends IShape {
    readonly wires: ReadonlyArray<IWire>;
}

export interface IShell extends IShape {
    readonly faces: ReadonlyArray<IFace>;
}

export interface ISolid extends IShape {
    readonly shells: ReadonlyArray<IShell>;
}

export interface ICompound extends IShape {
    readonly shapes: ReadonlyArray<IShape>;
}

export interface ICompoundSolid extends IShape {
    readonly solids: ReadonlyArray<ISolid>;
}
