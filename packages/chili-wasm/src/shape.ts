import { IEdge, IShape, IShapeMeshData, IWire, Matrix4, Orientation, Plane, ShapeType } from "chili-core";
import { TopoDS_Shape, Shape } from "../lib/chili-wasm";
import { OcctHelper } from "./helper";
import { Mesher } from "./mesher";

export class OccShape implements IShape {
    readonly shapeType: ShapeType;
    readonly mesh: IShapeMeshData;

    protected _shape: TopoDS_Shape;
    get shape(): TopoDS_Shape {
        return this._shape;
    }

    get id(): string {
        throw new Error("Method not implemented.");
    }
    matrix: Matrix4;

    constructor(shape: TopoDS_Shape) {
        this._shape = shape;
        this.shapeType = OcctHelper.getShapeType(shape);
        this.mesh = new Mesher(this);
        this.matrix = new Matrix4();
    }

    isClosed(): boolean {
        return wasm.Shape.isClosed(this.shape);
    }

    isNull(): boolean {
        return this.shape.isNull();
    }

    isEqual(other: IShape): boolean {
        if (other instanceof OccShape) {
            return this.shape.isEqual(other.shape);
        }
        return false;
    }

    isSame(other: IShape): boolean {
        if (other instanceof OccShape) {
            return this.shape.isSame(other.shape);
        }
        return false;
    }

    isPartner(other: IShape): boolean {
        if (other instanceof OccShape) {
            return this.shape.isPartner(other.shape);
        }
        return false;
    }

    orientation(): Orientation {
        return OcctHelper.getOrientation(this.shape);
    }

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        if (fromShape instanceof OccShape) {
            return wasm.Shape.findAncestor(
                fromShape.shape,
                this.shape,
                OcctHelper.getShapeEnum(ancestorType),
            ).map((x) => OcctHelper.wrapShape(x));
        }
        return [];
    }

    findSubShapes(subshapeType: ShapeType): IShape[] {
        return wasm.Shape.findSubShapes(this.shape, OcctHelper.getShapeEnum(subshapeType)).map((x) =>
            OcctHelper.wrapShape(x),
        );
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

    dispose(): void {
        this._shape.delete();
        this._shape = null as any;
    }
}
