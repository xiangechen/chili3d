import { IShape, Orientation, ShapeType } from "chili-core";
import { TopAbs_ShapeEnum, TopoDS_Shape } from "../lib/chili-wasm";
import { OccShape } from "./shape";

export class OcctHelper {
    static getOrientation(shape: TopoDS_Shape): Orientation {
        switch (shape.orientation()) {
            case wasm.TopAbs_Orientation.TopAbs_FORWARD:
                return Orientation.FORWARD;
            case wasm.TopAbs_Orientation.TopAbs_REVERSED:
                return Orientation.REVERSED;
            case wasm.TopAbs_Orientation.TopAbs_INTERNAL:
                return Orientation.INTERNAL;
            case wasm.TopAbs_Orientation.TopAbs_EXTERNAL:
                return Orientation.EXTERNAL;
            default:
                return Orientation.FORWARD;
        }
    }

    static getShapeType(shape: TopoDS_Shape): ShapeType {
        switch (shape.shapeType()) {
            case wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return ShapeType.Compound;
            case wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return ShapeType.CompoundSolid;
            case wasm.TopAbs_ShapeEnum.TopAbs_SOLID:
                return ShapeType.Solid;
            case wasm.TopAbs_ShapeEnum.TopAbs_SHELL:
                return ShapeType.Shell;
            case wasm.TopAbs_ShapeEnum.TopAbs_FACE:
                return ShapeType.Face;
            case wasm.TopAbs_ShapeEnum.TopAbs_WIRE:
                return ShapeType.Wire;
            case wasm.TopAbs_ShapeEnum.TopAbs_EDGE:
                return ShapeType.Edge;
            case wasm.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return ShapeType.Vertex;
            default:
                return ShapeType.Shape;
        }
    }

    static getShapeEnum(shapeType: ShapeType): TopAbs_ShapeEnum {
        switch (shapeType) {
            case ShapeType.Compound:
                return wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND;
            case ShapeType.CompoundSolid:
                return wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID;
            case ShapeType.Solid:
                return wasm.TopAbs_ShapeEnum.TopAbs_SOLID;
            case ShapeType.Shell:
                return wasm.TopAbs_ShapeEnum.TopAbs_SHELL;
            case ShapeType.Face:
                return wasm.TopAbs_ShapeEnum.TopAbs_FACE;
            case ShapeType.Wire:
                return wasm.TopAbs_ShapeEnum.TopAbs_WIRE;
            case ShapeType.Edge:
                return wasm.TopAbs_ShapeEnum.TopAbs_EDGE;
            case ShapeType.Vertex:
                return wasm.TopAbs_ShapeEnum.TopAbs_VERTEX;
            case ShapeType.Shape:
                return wasm.TopAbs_ShapeEnum.TopAbs_SHAPE;
            default:
                throw new Error("Unknown shape type: " + shapeType);
        }
    }

    static wrapShape(shape: TopoDS_Shape): IShape {
        return new OccShape(shape);
    }
}
