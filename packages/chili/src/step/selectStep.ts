// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    GeometryModel,
    I18nKeys,
    IDocument,
    IModel,
    IShapeFilter,
    Model,
    ShapeType,
} from "chili-core";
import { Selection } from "../selection";
import { SnapedData } from "../snap";
import { IStep } from "./step";

export class SelectShapeStep implements IStep {
    constructor(
        readonly snapeType: ShapeType,
        readonly prompt: I18nKeys,
        readonly multiple: boolean = false,
        readonly filter?: IShapeFilter,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        let shapes = await Selection.pickShape(
            document,
            this.snapeType,
            this.prompt,
            controller,
            this.multiple,
            this.filter,
        );
        return {
            view: document.visual.viewer.activeView!,
            shapes,
        };
    }
}

export class SelectModelStep implements IStep {
    constructor(
        readonly prompt: I18nKeys,
        readonly multiple: boolean = false,
        readonly filter?: IShapeFilter,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        let models: IModel[] = this.getSelectedModels(document);
        if (models.length === 0) {
            models = await Selection.pickModel(
                document,
                this.prompt,
                controller,
                this.multiple,
                this.filter,
            );
        }
        document.selection.clearSelected();
        if (models.length === 0) return undefined;
        return {
            view: document.visual.viewer.activeView!,
            shapes: [],
            models,
        };
    }

    private getSelectedModels(document: IDocument) {
        return document.selection
            .getSelectedNodes()
            .map((x) => x as GeometryModel)
            .filter((x) => {
                if (x === undefined) return false;
                let shape = x.shape();
                if (shape === undefined) return false;
                if (this.filter !== undefined && !this.filter.allow(shape)) return false;
                return true;
            });
    }
}
