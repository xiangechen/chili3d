// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    I18nKeys,
    IDocument,
    INodeFilter,
    IShapeFilter,
    ShapeNodeFilter,
    ShapeType,
    VisualState,
} from "chili-core";
import { SnapResult } from "../snap";
import { IStep } from "./step";

export interface SelectShapeOptions {
    multiple?: boolean;
    filter?: IShapeFilter;
    selectedState?: VisualState;
    keepSelection?: boolean;
}

export abstract class SelectStep implements IStep {
    constructor(
        readonly snapeType: ShapeType,
        readonly prompt: I18nKeys,
        readonly options?: SelectShapeOptions,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const { shapeType, shapeFilter, nodeFilter } = document.selection;
        document.selection.shapeType = this.snapeType;
        document.selection.shapeFilter = this.options?.filter;
        if (!this.options?.keepSelection) {
            document.selection.clearSelection();
            document.visual.highlighter.clear();
        }
        try {
            return await this.select(document, controller);
        } finally {
            document.selection.shapeType = shapeType;
            document.selection.shapeFilter = shapeFilter;
            document.selection.nodeFilter = nodeFilter;
        }
    }

    abstract select(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined>;
}

export class SelectShapeStep extends SelectStep {
    override async select(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapResult | undefined> {
        const shapes = await document.selection.pickShape(
            this.prompt,
            controller,
            this.options?.multiple === true,
            this.options?.selectedState,
        );
        if (shapes.length === 0) return undefined;
        return {
            view: document.application.activeView!,
            shapes,
        };
    }
}

export class SelectShapeNodeStep extends SelectStep {
    constructor(prompt: I18nKeys, options?: SelectShapeOptions) {
        super(ShapeType.Shape, prompt, options);
    }

    override async select(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapResult | undefined> {
        document.selection.nodeFilter = new ShapeNodeFilter();
        const nodes = await document.selection.pickNode(
            this.prompt,
            controller,
            this.options?.multiple === true,
        );
        if (nodes.length === 0) return undefined;
        return {
            view: document.application.activeView!,
            shapes: [],
            nodes,
        };
    }
}

export class SelectNodeStep implements IStep {
    constructor(
        readonly prompt: I18nKeys,
        readonly multiple: boolean = false,
        readonly filter?: INodeFilter,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const oldFilter = document.selection.nodeFilter;
        document.selection.nodeFilter = this.filter;
        try {
            document.selection.nodeFilter = this.filter;
            const nodes = await document.selection.pickNode(this.prompt, controller, this.multiple);
            if (nodes.length === 0) return undefined;
            return {
                view: document.application.activeView!,
                shapes: [],
                nodes,
            };
        } finally {
            document.selection.nodeFilter = oldFilter;
        }
    }
}
