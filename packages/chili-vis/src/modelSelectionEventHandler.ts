// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    IDocument,
    IModel,
    INode,
    IShapeFilter,
    IView,
    ShapeType,
    VisualShapeData,
} from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ModelSelectionHandler extends SelectionHandler {
    models(): IModel[] {
        return this.document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x)) as IModel[];
    }

    constructor(
        document: IDocument,
        multiMode: boolean,
        controller?: AsyncController,
        filter?: IShapeFilter,
    ) {
        super(document, ShapeType.Shape, multiMode, controller, filter);
    }

    protected override select(view: IView, shapes: VisualShapeData[], event: PointerEvent): number {
        if (shapes.length === 0) {
            this.document.selection.clearSelection();
            return 0;
        }
        let models = shapes
            .map((x) => view.viewer.visual.context.getModel(x.owner))
            .filter((x) => x !== undefined) as IModel[];
        this.document.selection.setSelection(models, event.shiftKey);
        return models.length;
    }

    override clearSelected(document: IDocument): void {
        document.selection.clearSelection();
    }
}
