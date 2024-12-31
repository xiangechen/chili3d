import {
    EditableShapeNode,
    FolderNode,
    GroupNode,
    IDocument,
    IShape,
    IShapeConverter,
    Material,
    Matrix4,
    Result,
    gc,
} from "chili-core";
import { ShapeNode } from "../lib/chili-wasm";
import { OcctHelper } from "./helper";
import { OccShape } from "./shape";

export class OccShapeConverter implements IShapeConverter {
    private readonly addShapeNode = (
        folder: FolderNode,
        node: ShapeNode,
        children: ShapeNode[],
        getMaterialId: (document: IDocument, color: string) => string,
    ) => {
        if (node.shape) {
            let shape = OcctHelper.wrapShape(node.shape);
            let material = getMaterialId(folder.document, node.color as string);
            folder.add(new EditableShapeNode(folder.document, node.name as string, shape, material));
        }

        children.forEach((child) => {
            let childFolder = folder;
            let subChildren = child.getChildren();
            if (subChildren.length > 1) {
                childFolder = new GroupNode(folder.document, child.name as string);
                folder.add(childFolder);
            }
            this.addShapeNode(childFolder, child, subChildren, getMaterialId);
        });
    };

    convertToIGES(...shapes: IShape[]): Result<string> {
        let occShapes = shapes.map((shape) => {
            if (shape instanceof OccShape) {
                return shape.shape;
            }
            throw new Error("Shape is not an OccShape");
        });
        return Result.ok(wasm.Converter.convertToIges(occShapes));
    }

    convertFromIGES(document: IDocument, iges: Uint8Array): Result<FolderNode> {
        return this.converterFromData(document, iges, wasm.Converter.convertFromIges);
    }

    private readonly converterFromData = (
        document: IDocument,
        data: Uint8Array,
        converter: (data: Uint8Array) => ShapeNode | undefined,
    ) => {
        const materialMap: Map<string, string> = new Map();
        const getMaterialId = (document: IDocument, color: string) => {
            if (!materialMap.has(color)) {
                let material = new Material(document, color, color);
                document.materials.push(material);
                materialMap.set(color, material.id);
            }
            return materialMap.get(color)!;
        };

        return gc((c) => {
            let node = converter(data);
            if (!node) {
                return Result.err("can not convert");
            }
            let folder = new GroupNode(document, "undefined");
            this.addShapeNode(folder, node, node.getChildren(), getMaterialId);
            c(node);
            return Result.ok(folder);
        });
    };

    convertToSTEP(...shapes: IShape[]): Result<string> {
        let occShapes = shapes.map((shape) => {
            if (shape instanceof OccShape) {
                return shape.shape;
            }
            throw new Error("Shape is not an OccShape");
        });
        return Result.ok(wasm.Converter.convertToStep(occShapes));
    }

    convertFromSTEP(document: IDocument, step: Uint8Array): Result<FolderNode> {
        return this.converterFromData(document, step, wasm.Converter.convertFromStep);
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
