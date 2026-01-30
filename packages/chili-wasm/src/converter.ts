// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Deletable,
    EditableShapeNode,
    type FolderNode,
    GroupNode,
    gc,
    type IDisposable,
    type IDocument,
    type IShape,
    type IShapeConverter,
    Material,
    Result,
} from "chili-core";
import type { ShapeNode } from "../lib/chili-wasm";
import { OccShape } from "./shape";

export class OccShapeConverter implements IShapeConverter {
    private readonly addShapeNode = (
        collector: (d: Deletable | IDisposable) => any,
        folder: FolderNode,
        node: ShapeNode,
        children: ShapeNode[],
        getMaterialId: (document: IDocument, color: string) => string,
    ) => {
        if (node.shape && !node.shape.isNull()) {
            const shape = OccShape.wrap(node.shape);
            const material = getMaterialId(folder.document, node.color as string);
            folder.add(new EditableShapeNode(folder.document, node.name, shape, material));
        }

        children.forEach((child) => {
            collector(child);
            const subChildren = child.getChildren();
            const childFolder = subChildren.length > 1 ? new GroupNode(folder.document, child.name) : folder;

            if (subChildren.length > 1) {
                folder.add(childFolder);
            }
            this.addShapeNode(collector, childFolder, child, subChildren, getMaterialId);
        });
    };

    convertToIGES(...shapes: IShape[]): Result<string> {
        const occShapes = shapes.map((shape) => {
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
            // Provide default color for undefined, null, or empty color values
            const materialColor = color || "#808080"; // Default gray color
            const materialKey = materialColor;

            if (!materialMap.has(materialKey)) {
                const material = new Material(document, materialKey, materialColor);
                document.modelManager.materials.push(material);
                materialMap.set(materialKey, material.id);
            }
            return materialMap.get(materialKey)!;
        };

        return gc((c) => {
            const node = converter(data);
            if (!node) {
                return Result.err("can not convert");
            }
            const folder = new GroupNode(document, "undefined");
            this.addShapeNode(c, folder, node, node.getChildren(), getMaterialId);
            c(node);
            return Result.ok(folder);
        });
    };

    convertToSTEP(...shapes: IShape[]): Result<string> {
        const occShapes = shapes.map((shape) => {
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
        const shape = wasm.Converter.convertFromBrep(brep);
        if (shape.isNull()) {
            return Result.err("can not convert");
        }
        return Result.ok(OccShape.wrap(shape));
    }

    convertFromSTL(document: IDocument, stl: Uint8Array): Result<FolderNode> {
        return this.converterFromData(document, stl, wasm.Converter.convertFromStl);
    }
}
