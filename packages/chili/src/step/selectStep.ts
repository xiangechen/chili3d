// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, I18nKeys, IDocument, IShapeFilter, ShapeType } from "chili-core";
import { SnapedData } from "../snap";
import { IStep } from "./step";

export abstract class SelectStep implements IStep {
    constructor(
        readonly snapeType: ShapeType,
        readonly prompt: I18nKeys,
        readonly multiple: boolean = false,
        readonly filter?: IShapeFilter,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        let oldShapeType = document.selection.shapeType;
        let oldFilter = document.selection.filter;
        try {
            document.selection.shapeType = this.snapeType;
            document.selection.filter = this.filter;
            return await this.select(document, controller);
        } finally {
            document.selection.shapeType = oldShapeType;
            document.selection.filter = oldFilter;
        }
    }

    abstract select(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined>;
}

export class SelectShapeStep extends SelectStep {
    override async select(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapedData | undefined> {
        let shapes = await document.selection.pickShape(this.prompt, controller, this.multiple);
        if (shapes.length === 0) return undefined;
        return {
            view: document.application.activeView!,
            shapes,
        };
    }
}

export class SelectModelStep extends SelectStep {
    constructor(prompt: I18nKeys, multiple: boolean, filter?: IShapeFilter) {
        super(ShapeType.Shape, prompt, multiple, filter);
    }

    override async select(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapedData | undefined> {
        let models = await document.selection.pickModel(this.prompt, controller, this.multiple);
        if (models.length === 0) return undefined;
        return {
            view: document.application.activeView!,
            shapes: [],
            models,
        };
    }
}
