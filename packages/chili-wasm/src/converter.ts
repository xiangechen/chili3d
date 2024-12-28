import { IShape, IShapeConverter, Result, ShapeInfo } from "chili-core";
import { OccShape } from "./shape";
import { OcctHelper } from "./helper";
import { ShapeNode } from "../lib/chili-wasm";

function shapeNodeToShapeInfo(node: ShapeNode): ShapeInfo {
    return {
        name: node.name as string,
        shape: OcctHelper.wrapShape(node.shape!),
        color: node.color as string
    };
}

const parseShapeNodeToShapes = (shapes: ShapeInfo[], shapeNode: ShapeNode | undefined) => {
    if (!shapeNode) {
        return;
    }

    if (shapeNode.shape) {
        shapes.push(shapeNodeToShapeInfo(shapeNode));
    }

    shapeNode.getChildren().forEach((child) => {
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

    convertFromIGES(iges: Uint8Array): Result<ShapeInfo[]> {
        let shapes: ShapeInfo[] = [];
        let node = wasm.Converter.convertFromIges(iges);

        parseShapeNodeToShapes(shapes, node);

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
    
    convertFromSTEP(step: Uint8Array): Result<ShapeInfo[]> {
        let shapes: ShapeInfo[] = [];
        let node = wasm.Converter.convertFromStep(step);

        parseShapeNodeToShapes(shapes, node);

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
