// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    GeometryNode,
    IDocument,
    IShapeFilter,
    IView,
    ShapeType,
    VisualShapeData,
} from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ModelSelectionHandler extends SelectionHandler {
    models(): GeometryNode[] {
        return this.document.selection.getSelectedNodes().filter((x) => x instanceof GeometryNode);
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
            this.clearSelected(this.document);
            return 0;
        }
        let models = shapes
            .map((x) => view.document.visual.context.getModel(x.owner))
            .filter((x) => x !== undefined);
        this.document.selection.setSelection(models, event.shiftKey);
        return models.length;
    }

    override clearSelected(document: IDocument): void {
        document.selection.clearSelection();
    }
}
