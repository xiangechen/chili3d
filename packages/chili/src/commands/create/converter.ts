// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CancelableCommand,
    GeometryModel,
    IDocument,
    IEdge,
    IModel,
    IShapeFilter,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
import { FaceBody } from "../../bodys/face";
import { WireBody } from "../../bodys/wire";
import { SelectModelStep } from "../../step";

let count = 1;

abstract class ConvertCommand extends CancelableCommand {
    async executeAsync(): Promise<void> {
        let models = await this.getOrPickModels(this.document);
        if (!models) return;
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let geometryModel = this.create(this.document, models!);
            this.document.addNode(geometryModel);
            this.document.visual.viewer.update();
        });
    }

    protected abstract create(document: IDocument, models: IModel[]): GeometryModel;

    async getOrPickModels(document: IDocument) {
        let filter: IShapeFilter = {
            allow: (shape) => {
                return shape.shapeType === ShapeType.Edge || shape.shapeType === ShapeType.Wire;
            },
        };
        let models = this._getSelectedModels(document, filter);
        if (models.length > 0) return models;
        document.selection.clearSelected();
        let step = new SelectModelStep("prompt.select.models", true);
        this.controller = new AsyncController();
        let data = await step.execute(document, this.controller);
        return data?.models;
    }

    private _getSelectedModels(document: IDocument, filter?: IShapeFilter) {
        return document.selection
            .getSelectedNodes()
            .map((x) => x as GeometryModel)
            .filter((x) => {
                if (x === undefined) return false;
                let shape = x.shape();
                if (shape === undefined) return false;
                if (filter !== undefined && !filter.allow(shape)) return false;
                return true;
            });
    }
}

@command({
    name: "convert.toWire",
    display: "command.toWire",
    icon: "icon-toPoly",
})
export class ConvertToWire extends ConvertCommand {
    protected override create(document: IDocument, models: IModel[]): GeometryModel {
        let edges = models.map((x) => x.shape()) as IEdge[];
        let wireBody = new WireBody(document, edges);
        models.forEach((x) => x.parent?.remove(x));
        return new GeometryModel(document, `Wire ${count++}`, wireBody);
    }
}

@command({
    name: "convert.toFace",
    display: "command.toFace",
    icon: "icon-toFace",
})
export class ConvertToFace extends ConvertCommand {
    protected override create(document: IDocument, models: IModel[]): GeometryModel {
        let edges = models.map((x) => x.shape()) as IEdge[];
        let wireBody = new FaceBody(document, edges);
        models.forEach((x) => x.parent?.remove(x));
        return new GeometryModel(document, `Face ${count++}`, wireBody);
    }
}
