import {
    IEdge,
    IFace,
    IShape,
    IShapeMeshData,
    IWire,
    Matrix4,
    Orientation,
    Plane,
    ShapeType,
} from "chili-core";
import { TopoDS_Shape } from "../lib/chili-wasm";

export class OccShape implements IShape {
    shapeType: ShapeType;
    get id(): string {
        throw new Error("Method not implemented.");
    }
    get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }
    matrix: Matrix4;

    constructor(readonly shape: TopoDS_Shape) {
        this.shapeType = ShapeType.Shape;
        this.matrix = new Matrix4();
    }

    isClosed(): boolean {
        throw new Error("Method not implemented.");
    }
    isEmpty(): boolean {
        throw new Error("Method not implemented.");
    }
    isEqual(other: IShape): boolean {
        throw new Error("Method not implemented.");
    }
    isSame(other: IShape): boolean {
        throw new Error("Method not implemented.");
    }
    isPartner(other: IShape): boolean {
        throw new Error("Method not implemented.");
    }
    orientation(): Orientation {
        throw new Error("Method not implemented.");
    }
    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        throw new Error("Method not implemented.");
    }
    findSubShapes(subshapeType: ShapeType): IShape[] {
        throw new Error("Method not implemented.");
    }
    iterSubShapes(shapeType: ShapeType, unique: boolean): IterableIterator<IShape> {
        throw new Error("Method not implemented.");
    }
    section(shape: IShape | Plane): IShape {
        throw new Error("Method not implemented.");
    }
    split(edges: (IEdge | IWire)[]): IShape {
        throw new Error("Method not implemented.");
    }
    splitWithFace(onFace: IFace, edges: IEdge | IWire): IShape {
        throw new Error("Method not implemented.");
    }
    splitWithEdge(onEdge: IEdge, edge: IEdge): IShape {
        throw new Error("Method not implemented.");
    }
    dispose(): void {
        throw new Error("Method not implemented.");
    }
}
