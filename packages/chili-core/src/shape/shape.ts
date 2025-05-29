// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDisposable, Result } from "../foundation";
import { Matrix4, Plane, Ray, XYZ } from "../math";
import { ICurve, ITrimmedCurve } from "./curve";
import { EdgeMeshData, IShapeMeshData } from "./meshData";
import { ShapeType } from "./shapeType";
import { ISurface } from "./surface";

export enum Orientation {
    FORWARD,
    REVERSED,
    INTERNAL,
    EXTERNAL,
}

export interface IShape extends IDisposable {
    readonly shapeType: ShapeType;
    get id(): string;
    get mesh(): IShapeMeshData;
    transformed(matrix: Matrix4): IShape;
    transformedMul(matrix: Matrix4): IShape;
    edgesMeshPosition(): EdgeMeshData;
    matrix: Matrix4;
    isClosed(): boolean;
    isNull(): boolean;
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
    findSubShapes(subshapeType: ShapeType): IShape[];
    iterShape(): IShape[];
    section(shape: IShape | Plane): IShape;
    split(edges: (IEdge | IWire)[]): IShape;
    reserve(): void;
    clone(): IShape;
}

export interface ISubShape extends IShape {
    index: number;
    parent: IShape;
}

export interface ISubEdgeShape extends ISubShape, IEdge {}

export interface ISubFaceShape extends ISubShape, IFace {}

export interface IVertex extends IShape {}

export interface IEdge extends IShape {
    update(curve: ICurve): void;
    intersect(other: IEdge | Ray): { parameter: number; point: XYZ }[];
    length(): number;
    get curve(): ITrimmedCurve;
    offset(distance: number, dir: XYZ): Result<IEdge>;
    trim(start: number, end: number): IEdge;
}

export enum JoinType {
    arc,
    tangent,
    intersection,
}

export interface IWire extends IShape {
    toFace(): Result<IFace>;
    edgeLoop(): IEdge[];
    offset(distance: number, joinType: JoinType): Result<IShape>;
}

export interface IFace extends IShape {
    area(): number;
    normal(u: number, v: number): [point: XYZ, normal: XYZ];
    outerWire(): IWire;
    surface(): ISurface;
    segmentsOfEdgeOnFace(edge: IEdge):
        | undefined
        | {
              start: number;
              end: number;
          };
}

export interface IShell extends IShape {}

export interface ISolid extends IShape {
    volume(): number;
}

export interface ICompound extends IShape {}

export interface ICompoundSolid extends IShape {}
