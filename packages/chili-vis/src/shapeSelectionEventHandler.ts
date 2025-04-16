// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument, IView, VisualShapeData, VisualState } from "chili-core";
import { ShapeSelectionHandler } from "./selectionEventHandler";

export class SubshapeSelectionHandler extends ShapeSelectionHandler {
    private readonly _shapes: Set<VisualShapeData> = new Set();
    selectedState: VisualState = VisualState.edgeSelected;

    shapes(): VisualShapeData[] {
        return [...this._shapes];
    }

    override clearSelected(document: IDocument): void {
        for (const shape of this._shapes.values()) {
            this.removeSelected(shape);
        }
        this._shapes.clear();
    }

    protected override select(view: IView, event: PointerEvent): number {
        const document = view.document.visual.document;
        if (event.shiftKey) {
            this._highlights?.forEach((x) =>
                this._shapes.has(x) ? this.removeSelected(x) : this.addSelected(x),
            );
        } else {
            this.clearSelected(document);
            this._highlights?.forEach(this.addSelected.bind(this));
        }
        return this._shapes.size;
    }

    private removeSelected(shape: VisualShapeData) {
        this._shapes.delete(shape);
        shape.owner.geometryNode.document.visual.highlighter.removeState(
            shape.owner,
            this.selectedState,
            shape.shape.shapeType,
            ...shape.indexes,
        );
    }

    private addSelected(shape: VisualShapeData) {
        shape.owner.geometryNode.document.visual.highlighter.addState(
            shape.owner,
            this.selectedState,
            this.shapeType,
            ...shape.indexes,
        );
        this._shapes.add(shape);
    }
}
