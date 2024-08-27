// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CancelableCommand,
    GeometryEntity,
    GeometryModel,
    IDocument,
    IEdge,
    IModel,
    IShapeFilter,
    ParameterGeometryEntity,
    PubSub,
    Result,
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
        if (!models) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        Transaction.excute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let geometryModel = this.create(this.document, models);
            if (!geometryModel.isOk) {
                PubSub.default.pub("showToast", "toast.converter.error");
            } else {
                let model = new GeometryModel(
                    this.document,
                    `${geometryModel.ok().display}${count++}`,
                    geometryModel.ok(),
                );
                this.document.addNode(model);
                this.document.visual.update();
                PubSub.default.pub("showToast", "toast.success");
            }
        });
    }

    protected abstract create(document: IDocument, models: IModel[]): Result<GeometryEntity>;

    async getOrPickModels(document: IDocument) {
        let filter: IShapeFilter = {
            allow: (shape) => {
                return shape.shapeType === ShapeType.Edge || shape.shapeType === ShapeType.Wire;
            },
        };
        let models = this._getSelectedModels(document, filter);
        document.selection.clearSelection();
        if (models.length > 0) return models;
        let step = new SelectModelStep("prompt.select.models", true, filter);
        this.controller = new AsyncController();
        let data = await step.execute(document, this.controller);
        document.selection.clearSelection();
        return data?.models;
    }

    private _getSelectedModels(document: IDocument, filter?: IShapeFilter) {
        return document.selection
            .getSelectedNodes()
            .map((x) => x as GeometryModel)
            .filter((x) => {
                if (x === undefined) return false;
                let shape = x.geometry.shape.ok();
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
    protected override create(document: IDocument, models: IModel[]): Result<GeometryEntity> {
        let edges = models.map((x) => x.geometry.shape.ok()) as IEdge[];
        let wireBody = new WireBody(document, edges);
        let shape = wireBody.generateShape();
        if (!shape.isOk) {
            return Result.err(shape.error());
        }
        models.forEach((x) => x.parent?.remove(x));
        return Result.ok(new ParameterGeometryEntity(document, wireBody));
    }
}

@command({
    name: "convert.toFace",
    display: "command.toFace",
    icon: "icon-toFace",
})
export class ConvertToFace extends ConvertCommand {
    protected override create(document: IDocument, models: IModel[]): Result<GeometryEntity> {
        let edges = models.map((x) => x.geometry.shape.ok()) as IEdge[];
        let wireBody = new FaceBody(document, edges);
        let shape = wireBody.generateShape();

        if (!shape.isOk) {
            return Result.err(shape.error());
        }
        models.forEach((x) => x.parent?.remove(x));
        return Result.ok(new ParameterGeometryEntity(document, wireBody));
    }
}
