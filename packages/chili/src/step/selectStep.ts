// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18nKeys, IDocument, IShapeFilter, ShapeType } from "chili-core";
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
        let shapes = await document.selection.pickShape(
            this.snapeType,
            this.prompt,
            controller,
            this.multiple,
            this.filter,
        );
        if (shapes.length === 0) return undefined;
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
        let models = await document.selection.pickModel(this.prompt, controller, this.multiple, this.filter);
        if (models.length === 0) return undefined;
        return {
            view: document.visual.viewer.activeView!,
            shapes: [],
            models,
        };
    }
}
