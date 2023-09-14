// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, IView, VisualShapeData, VisualState } from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export class ShapeSelectionHandler extends SelectionHandler {
    private _shapes: Set<VisualShapeData> = new Set();

    shapes(): VisualShapeData[] {
        return [...this._shapes];
    }

    override dispose(): void {
        super.dispose();
        this._shapes.clear();
    }

    override clearSelected(document: IDocument): void {
        for (const shape of this._shapes.values()) {
            shape.owner.removeState(VisualState.selected, shape.shape.shapeType, shape.index);
        }
        this._shapes.clear();
    }

    protected override select(view: IView, shapes: VisualShapeData[], event: PointerEvent): number {
        if (event.shiftKey) {
            shapes.forEach((x) => {
                if (this._shapes.has(x)) {
                    this.removeSelected(x);
                } else {
                    this.addSelected(x);
                }
            });
        } else {
            this.clearSelected(view.viewer.visual.document);
            shapes.forEach((x) => {
                this.addSelected(x);
            });
        }
        return this._shapes.size;
    }

    private removeSelected(shape: VisualShapeData) {
        this._shapes.delete(shape);
        shape.owner.removeState(VisualState.selected, shape.shape.shapeType, shape.index);
    }

    private addSelected(shape: VisualShapeData) {
        shape.owner.addState(VisualState.selected, shape.shape.shapeType, shape.index);
        this._shapes.add(shape);
    }
}
