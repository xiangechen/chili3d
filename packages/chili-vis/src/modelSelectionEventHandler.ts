// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModel, IView, VisualShapeData } from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ModelSelectionHandler extends SelectionHandler {
    protected override select(view: IView, highlights: VisualShapeData[], event: PointerEvent): void {
        if (highlights.length === 0) {
            view.viewer.visual.document.selection.clearSelected();
        } else {
            let nodes: IModel[] = [];
            highlights.forEach((x) => {
                let model = view.viewer.visual.context.getModel(x.owner);
                if (model) nodes.push(model);
            });
            view.viewer.visual.document.selection.select(nodes, event.shiftKey);
        }
    }
}
