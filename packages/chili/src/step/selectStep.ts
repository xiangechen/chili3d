// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    I18nKeys,
    IDocument,
    INodeFilter,
    IShapeFilter,
    ShapeNode,
    ShapeType,
    VisualState,
} from "chili-core";
import { SnapResult } from "../snap";
import { IStep } from "./step";

export interface SelectShapeOptions {
    multiple?: boolean;
    nodeFilter?: INodeFilter;
    shapeFilter?: IShapeFilter;
    selectedState?: VisualState;
    keepSelection?: boolean;
}

export interface SelectNodeOptions {
    multiple?: boolean;
    filter?: INodeFilter;
    keepSelection?: boolean;
}

export abstract class SelectStep implements IStep {
    constructor(
        readonly snapeType: ShapeType,
        readonly prompt: I18nKeys,
        readonly options?: SelectShapeOptions,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const { shapeType, shapeFilter } = document.selection;
        document.selection.shapeType = this.snapeType;
        document.selection.shapeFilter = this.options?.shapeFilter;
        if (!this.options?.keepSelection) {
            document.selection.clearSelection();
            document.visual.highlighter.clear();
        }
        try {
            return await this.select(document, controller);
        } finally {
            document.selection.shapeType = shapeType;
            document.selection.shapeFilter = shapeFilter;
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
            nodes: shapes.map((x) => x.owner.node),
        };
    }
}

export class SelectNodeStep implements IStep {
    constructor(
        readonly prompt: I18nKeys,
        readonly options?: SelectNodeOptions,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const { nodeFilter } = document.selection;
        document.selection.nodeFilter = this.options?.filter;
        if (!this.options?.keepSelection) {
            document.selection.clearSelection();
            document.visual.highlighter.clear();
        }
        try {
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
        } finally {
            document.selection.nodeFilter = nodeFilter;
        }
    }
}

export class GetOrSelectNodeStep extends SelectNodeStep {
    override execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const selected = document.selection.getSelectedNodes().filter((x) => {
            if (this.options?.filter?.allow) {
                return this.options.filter.allow(x);
            }

            return true;
        });

        if (selected.length > 0) {
            controller.success();
            return Promise.resolve({
                view: document.application.activeView!,
                shapes: [],
                nodes: selected as ShapeNode[],
            });
        }

        return super.execute(document, controller);
    }
}
