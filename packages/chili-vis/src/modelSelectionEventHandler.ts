// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    IDocument,
    IModel,
    IShapeFilter,
    IView,
    ShapeType,
    VisualShapeData,
} from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ModelSelectionHandler extends SelectionHandler {
    private _models: Set<IModel> = new Set();

    models(): IModel[] {
        return [...this._models];
    }

    constructor(
        document: IDocument,
        multiMode: boolean,
        readonly toSelect: boolean,
        controller?: AsyncController,
        filter?: IShapeFilter,
    ) {
        super(document, ShapeType.Shape, multiMode, controller, filter);
    }

    override dispose(): void {
        super.dispose();
        this._models.clear();
    }

    protected override select(view: IView, shapes: VisualShapeData[], event: PointerEvent): number {
        this._models.clear();
        if (shapes.length === 0) {
            view.viewer.visual.document.selection.clearSelected();
            return 0;
        }
        shapes.forEach((x) => {
            let model = view.viewer.visual.context.getModel(x.owner);
            if (model) this._models.add(model);
        });
        if (this.toSelect) {
            view.viewer.visual.document.selection.select(this.models(), event.shiftKey);
        }
        return this._models.size;
    }

    override clearSelected(document: IDocument): void {
        document.selection.clearSelected();
    }
}
