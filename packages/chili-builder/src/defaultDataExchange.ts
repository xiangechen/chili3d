// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    I18n,
    IDataExchange,
    IDocument,
    INode,
    IShape,
    PubSub,
    Result,
    ShapeNode,
    VisualNode,
} from "chili-core";

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
        let importResult: Result<INode> | undefined;

        const fileName = file.name.toLocaleLowerCase();
        if (this.extensionIs(fileName, ".brep")) {
            importResult = await this.importBrep(document, file);
        } else if (this.extensionIs(fileName, ".stl")) {
            importResult = await this.importStl(document, file);
        } else if (this.extensionIs(fileName, ".step", ".stp")) {
            importResult = await this.importStep(document, file);
        } else if (this.extensionIs(fileName, ".iges", ".igs")) {
            importResult = await this.importIges(document, file);
        }

        this.handleImportResult(document, fileName, importResult);
    }

    private extensionIs(fileName: string, ...extensions: string[]): boolean {
        return extensions.some((ext) => fileName.endsWith(ext));
    }

    private handleImportResult(document: IDocument, name: string, nodeResult: Result<INode> | undefined) {
        if (!nodeResult?.isOk) {
            alert(I18n.translate("error.import.unsupportedFileType:{0}", name));
            return;
        }

        const node = nodeResult.value;
        node.name = name;
        document.addNode(node);
        document.visual.update();
    }

    async importBrep(document: IDocument, file: File) {
        const shape = document.application.shapeFactory.converter.convertFromBrep(await file.text());
        if (!shape.isOk) {
            return Result.err(shape.error);
        }
        return Result.ok(new EditableShapeNode(document, file.name, shape.value));
    }

    private async importStl(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());
        return document.application.shapeFactory.converter.convertFromSTL(document, content);
    }

    private async importIges(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());
        return document.application.shapeFactory.converter.convertFromIGES(document, content);
    }

    private async importStep(document: IDocument, file: File) {
        const content = new Uint8Array(await file.arrayBuffer());
        return document.application.shapeFactory.converter.convertFromSTEP(document, content);
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
        if (type === ".step") return this.exportStep(doc, shapes);
        if (type === ".iges") return this.exportIges(doc, shapes);
        if (type === ".stl") return this.exportStl(doc, shapes);
        return this.exportBrep(doc, shapes);
    }

    private exportStep(doc: IDocument, shapes: IShape[]) {
        return doc.application.shapeFactory.converter.convertToSTEP(...shapes);
    }

    private exportIges(doc: IDocument, shapes: IShape[]) {
        return doc.application.shapeFactory.converter.convertToIGES(...shapes);
    }

    async exportBrep(document: IDocument, shapes: IShape[]) {
        const comp = document.application.shapeFactory.combine(shapes);
        if (!comp.isOk) {
            return Result.err(comp.error);
        }

        const result = document.application.shapeFactory.converter.convertToBrep(comp.value);
        comp.value.dispose();
        return result;
    }

    async exportStl(document: IDocument, shapes: IShape[]) {
        const comp = document.application.shapeFactory.combine(shapes);
        if (!comp.isOk) {
            return Result.err(comp.error);
        }

        const result = document.application.shapeFactory.converter.convertToSTL(comp.value);
        comp.value.dispose();
        return result;
    }

    private handleExportResult(result: Result<string> | undefined) {
        if (!result?.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", result?.error);
            return undefined;
        }
        return [result.value];
    }
}
