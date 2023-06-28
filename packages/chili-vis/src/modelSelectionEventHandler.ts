// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, IDocument, IModel, IView, ShapeType, VisualShapeData } from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ModelSelectionHandler extends SelectionHandler {
    constructor(document: IDocument, multiMode: boolean, token?: AsyncState) {
        super(document, ShapeType.Shape, multiMode, token);
    }

    protected override select(view: IView, shapes: VisualShapeData[], event: PointerEvent): void {
        if (shapes.length === 0) {
            view.viewer.visual.document.selection.clearSelected();
        } else {
            let nodes: IModel[] = [];
            shapes.forEach((x) => {
                let model = view.viewer.visual.context.getModel(x.owner);
                if (model) nodes.push(model);
            });
            view.viewer.visual.document.selection.select(nodes, event.shiftKey);
        }
    }

    override clearSelected(document: IDocument): void {
        document.selection.clearSelected();
    }
}
