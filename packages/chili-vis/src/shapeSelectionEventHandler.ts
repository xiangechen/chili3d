// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape, IView, VisualShapeData } from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ShapeSelectionHandler extends SelectionHandler {
    private _shapes: Set<IShape> = new Set();

    get shapes() {
        return this._shapes.values();
    }

    protected override select(view: IView, highlights: VisualShapeData[], event: PointerEvent): void {
        if (event.shiftKey) {
            highlights.forEach((x) => {
                if (this._shapes.has(x.shape)) {
                    this._shapes.delete(x.shape);
                } else {
                    this._shapes.add(x.shape);
                }
            });
        } else {
            this._shapes.clear();
            highlights.forEach((x) => {
                this._shapes.add(x.shape);
            });
        }
    }
}
