// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    I18nKeys,
    IDocument,
    INodeFilter,
    IShapeFilter,
    ShapeNodeFilter,
    ShapeType,
} from "chili-core";
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
        const { shapeType, shapeFilter, nodeFilter } = document.selection;
        try {
            document.selection.shapeType = this.snapeType;
            document.selection.shapeFilter = this.filter;
            return await this.select(document, controller);
        } finally {
            document.selection.shapeType = shapeType;
            document.selection.shapeFilter = shapeFilter;
            document.selection.nodeFilter = nodeFilter;
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

export class SelectShapeNodeStep extends SelectStep {
    constructor(prompt: I18nKeys, multiple: boolean, filter?: IShapeFilter) {
        super(ShapeType.Shape, prompt, multiple, filter);
    }

    override async select(
        document: IDocument,
        controller: AsyncController,
    ): Promise<SnapedData | undefined> {
        document.selection.nodeFilter = new ShapeNodeFilter();
        let nodes = await document.selection.pickNode(this.prompt, controller, this.multiple);
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

    async execute(document: IDocument, controller: AsyncController): Promise<SnapedData | undefined> {
        const oldFilter = document.selection.nodeFilter;
        try {
            document.selection.nodeFilter = this.filter;
            let nodes = await document.selection.pickNode(this.prompt, controller, this.multiple);
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
