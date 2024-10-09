import { IShape, IShapeConverter, Result } from "chili-core";
import { OccShape } from "./shape";
import { OcctHelper } from "./helper";
import { ShapeNode } from "../lib/chili-wasm";

const parseShapeNodeToShapes = (shapes: IShape[], shapeNode: ShapeNode) => {
    shapeNode.getChildren().forEach((child) => {
        if (child.shape) shapes.push(OcctHelper.wrapShape(child.shape));
        parseShapeNodeToShapes(shapes, child);
    });
    return shapes;
};

export class OccShapeConverter implements IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string> {
        let occShapes = shapes.map((shape) => {
            if (shape instanceof OccShape) {
                return shape.shape;
            }
            throw new Error("Shape is not an OccShape");
        });
        return Result.ok(wasm.Converter.convertToIges(occShapes));
    }

    convertFromIGES(iges: Uint8Array): Result<IShape[]> {
        let shapes: IShape[] = [];
        let node = wasm.Converter.convertFromIges(iges);

        if (node) {
            if (node.shape) {
                shapes.push(OcctHelper.wrapShape(node.shape));
            }
            parseShapeNodeToShapes(shapes, node);
        }

        return Result.ok(shapes);
    }
    convertToSTEP(...shapes: IShape[]): Result<string> {
        let occShapes = shapes.map((shape) => {
            if (shape instanceof OccShape) {
                return shape.shape;
            }
            throw new Error("Shape is not an OccShape");
        });
        return Result.ok(wasm.Converter.convertToStep(occShapes));
    }
    convertFromSTEP(step: Uint8Array): Result<IShape[]> {
        let shapes: IShape[] = [];
        let node = wasm.Converter.convertFromStep(step);

        if (node) {
            if (node.shape) {
                shapes.push(OcctHelper.wrapShape(node.shape));
            }
            parseShapeNodeToShapes(shapes, node);
        }

        return Result.ok(shapes);
    }
    convertToBrep(shape: IShape): Result<string> {
        if (shape instanceof OccShape) {
            return Result.ok(wasm.Converter.convertToBrep(shape.shape));
        }
        return Result.err("Shape is not an OccShape");
    }
    convertFromBrep(brep: string): Result<IShape> {
        let shape = wasm.Converter.convertFromBrep(brep);
        return Result.ok(OcctHelper.wrapShape(shape));
    }
}
