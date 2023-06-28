// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IShape, IView, VisualShapeData } from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ShapeSelectionHandler extends SelectionHandler {
    private _shapes: Set<IShape> = new Set();

    shapes(): readonly IShape[] {
        return [...this._shapes.values()];
    }

    override dispose(): void {
        super.dispose();
        this._shapes.clear();
    }

    override clearSelected(document: IDocument): void {}

    protected override select(view: IView, shapes: VisualShapeData[], event: PointerEvent): void {
        if (event.shiftKey) {
            shapes.forEach((x) => {
                if (this._shapes.has(x.shape)) {
                    this._shapes.delete(x.shape);
                } else {
                    this._shapes.add(x.shape);
                }
            });
        } else {
            this._shapes.clear();
            shapes.forEach((x) => {
                this._shapes.add(x.shape);
            });
        }
    }
}
