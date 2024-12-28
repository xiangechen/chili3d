// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "./document";
import { PubSub } from "./foundation";
import { EditableShapeNode, FolderNode, ShapeNode, VisualNode } from "./model";

export interface IDataExchange {
    importFormats(): string[];
    exportFormats(): string[];
    import(document: IDocument, files: FileList | File[]): Promise<void>;
    export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined>;
}

export class DefaultDataExchange implements IDataExchange {
    importFormats(): string[] {
        return [".step", ".stp", ".iges", ".igs"];
    }

    exportFormats(): string[] {
        return [".step", ".iges"];
    }

    async import(document: IDocument, files: FileList | File[]): Promise<void> {
        for (const file of files) {
            let content = new Uint8Array(await file.arrayBuffer());
            let factory = document.application.shapeFactory.converter.convertFromIGES;
            if (file.name.endsWith(".step") || file.name.endsWith(".stp")) {
                factory = document.application.shapeFactory.converter.convertFromSTEP;
            }
            let shape = factory(content);
            if (!shape.isOk) {
                PubSub.default.pub("showToast", "toast.read.error");
                return;
            }
            let shapes = shape.value.map((x, i) => {
                return new EditableShapeNode(document, x.name, x.shape);
            });
            let nodeList = new FolderNode(document, file.name);
            document.addNode(nodeList);
            nodeList.add(...shapes);
            document.visual.update();
        }
    }

    async export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined> {
        let shapes = nodes.map((x) => (x as ShapeNode).shape.value);
        let factory = nodes[0].document.application.shapeFactory.converter.convertToIGES;
        if (type === ".step") {
            factory = nodes[0].document.application.shapeFactory.converter.convertToSTEP;
        }
        let shapeString = factory(...shapes);
        if (!shapeString.isOk) {
            PubSub.default.pub("showToast", "toast.converter.error");
            return undefined;
        }

        return [shapeString.value];
    }
}
