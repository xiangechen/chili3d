// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    FolderNode,
    I18n,
    IDataExchange,
    IDocument,
    IShape,
    PubSub,
    Result,
    ShapeNode,
    VisualNode,
} from "chili-core";

async function importBrep(document: IDocument, file: File) {
    const shape = document.application.shapeFactory.converter.convertFromBrep(await file.text());
    if (!shape.isOk) {
        return Result.err(shape.error);
    }
    return Result.ok(new EditableShapeNode(document, file.name, shape.value));
}

async function exportBrep(document: IDocument, shapes: IShape[]) {
    const comp = document.application.shapeFactory.combine(shapes);
    if (!comp.isOk) {
        return Result.err(comp.error);
    }

    const result = document.application.shapeFactory.converter.convertToBrep(comp.value);
    comp.value.dispose();
    return result;
}

async function exportStl(document: IDocument, shapes: IShape[]) {
    const comp = document.application.shapeFactory.combine(shapes);
    if (!comp.isOk) {
        return Result.err(comp.error);
    }

    const result = document.application.shapeFactory.converter.convertToSTL(comp.value);
    comp.value.dispose();
    return result;
}

export class DefaultDataExchange implements IDataExchange {
    importFormats(): string[] {
        return [".step", ".stp", ".iges", ".igs", ".brep", ".stl"];
    }

    exportFormats(): string[] {
        return [".step", ".iges", ".brep", ".stl"];
    }

    async import(document: IDocument, files: FileList | File[]): Promise<void> {
        for (const file of files) {
            await this.handleSingleFileImport(document, file);
        }
    }

    private async handleSingleFileImport(document: IDocument, file: File) {
        let nodeResult: Result<EditableShapeNode | FolderNode> | undefined;

        if (file.name.endsWith(".brep")) {
            nodeResult = await importBrep(document, file);
        } else if (this.isStlFile(file.name)) {
            nodeResult = await this.handleStlImport(document, file);
        } else {
            nodeResult = await this.handleStepIgesImport(document, file);
        }

        if (!nodeResult?.isOk) return;

        const node = nodeResult.value;
        node.name = file.name;
        document.addNode(node);
        document.visual.update();
    }

    private async handleStepIgesImport(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());

        if (this.isStepFile(file.name)) {
            return document.application.shapeFactory.converter.convertFromSTEP(document, content);
        }

        if (this.isIgesFile(file.name)) {
            return document.application.shapeFactory.converter.convertFromIGES(document, content);
        }

        alert(I18n.translate("error.import.unsupportedFileType:{0}", file.name));
        return undefined;
    }

    async export(type: string, nodes: VisualNode[]): Promise<BlobPart[] | undefined> {
        if (!this.validateExportType(type)) return;

        const shapes = this.getExportShapes(nodes);
        if (!shapes.length) return;

        const shapeResult = await this.convertShapes(type, nodes[0].document, shapes);
        shapes.forEach((x) => x.dispose());

        return this.handleExportResult(shapeResult);
    }

    private validateExportType(type: string): boolean {
        const isValid = this.exportFormats().includes(type);
        !isValid && PubSub.default.pub("showToast", "error.import.unsupportedFileType:{0}", type);
        return isValid;
    }

    private getExportShapes(nodes: VisualNode[]): IShape[] {
        const shapes = nodes
            .filter((x): x is ShapeNode => x instanceof ShapeNode)
            .map((x) => x.shape.value.transformedMul(x.worldTransform()));

        !shapes.length && PubSub.default.pub("showToast", "error.export.noNodeCanBeExported");
        return shapes;
    }

    private async convertShapes(type: string, doc: IDocument, shapes: IShape[]) {
        if (type === ".step") return this.handleStepExport(doc, shapes);
        if (type === ".iges") return this.handleIgesExport(doc, shapes);
        if (type === ".stl") return exportStl(doc, shapes);
        return exportBrep(doc, shapes);
    }

    private handleStepExport(doc: IDocument, shapes: IShape[]) {
        return doc.application.shapeFactory.converter.convertToSTEP(...shapes);
    }

    private handleIgesExport(doc: IDocument, shapes: IShape[]) {
        return doc.application.shapeFactory.converter.convertToIGES(...shapes);
    }

    private handleExportResult(result: Result<string> | undefined) {
        if (!result?.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", result?.error);
            return undefined;
        }
        return [result.value];
    }

    private isStepFile(filename: string) {
        return filename.endsWith(".step") || filename.endsWith(".stp");
    }

    private isIgesFile(filename: string) {
        return filename.endsWith(".iges") || filename.endsWith(".igs");
    }

    private isStlFile(filename: string) {
        return filename.endsWith(".stl");
    }

    private async handleStlImport(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());
        return document.application.shapeFactory.converter.convertFromSTL(document, content);
    }
}
