// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CancelableCommand,
    GeometryNode,
    IDocument,
    IEdge,
    INode,
    IShapeFilter,
    PubSub,
    Result,
    ShapeNode,
    ShapeType,
    Transaction,
    command,
} from "chili-core";
import { FaceNode } from "../../bodys/face";
import { WireNode } from "../../bodys/wire";
import { SelectShapeNodeStep } from "../../step";

abstract class ConvertCommand extends CancelableCommand {
    async executeAsync(): Promise<void> {
        const models = await this.getOrPickModels(this.document);
        if (!models) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.create(this.document, models);
            if (!node.isOk) {
                PubSub.default.pub("showToast", "toast.converter.error");
            } else {
                this.document.addNode(node.value);
                this.document.visual.update();
                PubSub.default.pub("showToast", "toast.success");
            }
        });
    }

    protected abstract create(document: IDocument, models: INode[]): Result<GeometryNode>;

    async getOrPickModels(document: IDocument) {
        const filter: IShapeFilter = {
            allow: (shape) => shape.shapeType === ShapeType.Edge || shape.shapeType === ShapeType.Wire,
        };
        let models = this._getSelectedModels(document, filter);
        document.selection.clearSelection();
        if (models.length > 0) return models;

        const step = new SelectShapeNodeStep("prompt.select.models", { filter, multiple: true });
        this.controller = new AsyncController();
        const data = await step.execute(document, this.controller);
        document.selection.clearSelection();
        return data?.nodes;
    }

    private _getSelectedModels(document: IDocument, filter?: IShapeFilter) {
        return document.selection
            .getSelectedNodes()
            .map((x) => x as ShapeNode)
            .filter((x) => {
                if (x === undefined) return false;
                let shape = x.shape.value;
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
    protected override create(document: IDocument, models: ShapeNode[]): Result<GeometryNode> {
        const edges = models.map((x) => x.shape.value.copy()) as IEdge[];
        const wireBody = new WireNode(document, edges);
        const shape = wireBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);

        models.forEach((x) => x.parent?.remove(x));
        return Result.ok(wireBody);
    }
}

@command({
    name: "convert.toFace",
    display: "command.toFace",
    icon: "icon-toFace",
})
export class ConvertToFace extends ConvertCommand {
    protected override create(document: IDocument, models: ShapeNode[]): Result<GeometryNode> {
        const edges = models.map((x) => x.shape.value.copy()) as IEdge[];
        const wireBody = new FaceNode(document, edges);
        const shape = wireBody.generateShape();
        if (!shape.isOk) return Result.err(shape.error);

        models.forEach((x) => x.parent?.remove(x));
        return Result.ok(wireBody);
    }
}
