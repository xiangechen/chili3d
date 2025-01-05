// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "./document";
import { PubSub, Result } from "./foundation";
import { I18n } from "./i18n";
import { FolderNode, ShapeNode, VisualNode } from "./model";

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
            let shape: Result<FolderNode>;
            if (file.name.endsWith(".step") || file.name.endsWith(".stp")) {
                shape = document.application.shapeFactory.converter.convertFromSTEP(document, content);
            } else if (file.name.endsWith(".iges") || file.name.endsWith(".igs")) {
                shape = document.application.shapeFactory.converter.convertFromIGES(document, content);
            } else {
                alert(I18n.translate("error.import.unsupportedFileType:{0}", file.name));
                continue;
            }
            if (!shape.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", shape.error);
                continue;
            }
            shape.value.name = file.name;
            document.addNode(shape.value);
            document.visual.update();
        }
    }

    async export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined> {
        let shapes = nodes.filter((x) => x instanceof ShapeNode).map((x) => x.shape.value);
        if (shapes.length === 0) {
            PubSub.default.pub("showToast", "error.export.noNodeCanBeExported");
            return undefined;
        }
        let factory = nodes[0].document.application.shapeFactory.converter.convertToIGES;
        if (type === ".step") {
            factory = nodes[0].document.application.shapeFactory.converter.convertToSTEP;
        }
        let shapeString = factory(...shapes);
        if (!shapeString.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", shapeString.error);
            return undefined;
        }

        return [shapeString.value];
    }
}
