// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    IDocument,
    IShape,
    IShapeFilter,
    IView,
    ShapeType,
    VisualShapeData,
    VisualState,
} from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export abstract class ShapeSelectionHandler extends SelectionHandler {
    protected _highlights: VisualShapeData[] | undefined;
    private _detectAtMouse: VisualShapeData[] | undefined;
    private _lockDetected: IShape | undefined;

    constructor(
        document: IDocument,
        readonly shapeType: ShapeType,
        multiMode: boolean,
        controller?: AsyncController,
        readonly filter?: IShapeFilter,
    ) {
        super(document, multiMode, controller);
    }

    private getDetecteds(view: IView, event: PointerEvent) {
        if (
            this.rect &&
            Math.abs(this.mouse.x - event.offsetX) > 3 &&
            Math.abs(this.mouse.y - event.offsetY) > 3
        ) {
            return view.detectShapesRect(
                this.shapeType,
                this.mouse.x,
                this.mouse.y,
                event.offsetX,
                event.offsetY,
                this.filter,
            );
        }
        this._detectAtMouse = view.detectShapes(this.shapeType, event.offsetX, event.offsetY, this.filter);
        const detected = this.getDetecting();
        return detected ? [detected] : [];
    }

    protected override setHighlight(view: IView, event: PointerEvent) {
        let detecteds = this.getDetecteds(view, event);
        this.highlightDetecteds(view, detecteds);
    }

    protected highlightDetecteds(view: IView, detecteds: VisualShapeData[]) {
        this.cleanHighlights();
        detecteds.forEach((x) => {
            view.document.visual.highlighter.addState(
                x.owner,
                VisualState.edgeHighlight,
                this.shapeType,
                ...x.indexes,
            );
        });
        this._highlights = detecteds;
        view.update();
    }

    protected cleanHighlights() {
        this._highlights?.forEach((x) => {
            x.owner.node.document.visual.highlighter.removeState(
                x.owner,
                VisualState.edgeHighlight,
                this.shapeType,
                ...x.indexes,
            );
        });
        this._highlights = undefined;
    }

    protected highlightNext(view: IView) {
        if (this._detectAtMouse && this._detectAtMouse.length > 1) {
            let index = this._lockDetected
                ? (this.getDetcedtingIndex() + 1) % this._detectAtMouse.length
                : 1;
            this._lockDetected = this._detectAtMouse[index].shape;
            const detected = this.getDetecting();
            if (detected) this.highlightDetecteds(view, [detected]);
        }
    }

    private getDetecting() {
        if (this._detectAtMouse) {
            const index = this._lockDetected ? this.getDetcedtingIndex() : 0;
            return this._detectAtMouse[index];
        }
        return undefined;
    }

    private getDetcedtingIndex() {
        return this._detectAtMouse?.findIndex((x) => this._lockDetected === x.shape) ?? -1;
    }
}

export class SubshapeSelectionHandler extends ShapeSelectionHandler {
    private readonly _shapes: Map<IShape, VisualShapeData> = new Map();
    selectedState: VisualState = VisualState.edgeSelected;

    constructor(
        document: IDocument,
        shapeType: ShapeType,
        multiMode: boolean,
        controller?: AsyncController,
        filter?: IShapeFilter,
    ) {
        super(document, shapeType, multiMode, controller, filter);
        this.showRect = false;
    }

    shapes(): VisualShapeData[] {
        return [...this._shapes.values()];
    }

    override clearSelected(document: IDocument): void {
        for (const shape of this._shapes.values()) {
            this.removeSelected(shape);
        }
        this._shapes.clear();
    }

    protected override select(view: IView, event: PointerEvent): number {
        const document = view.document.visual.document;
        if (this.multiMode) {
            this._highlights?.forEach((x) =>
                this._shapes.has(x.shape) ? this.removeSelected(x) : this.addSelected(x),
            );
        } else {
            this.clearSelected(document);
            this._highlights?.forEach(this.addSelected.bind(this));
        }
        return this._shapes.size;
    }

    private removeSelected(shape: VisualShapeData) {
        this._shapes.delete(shape.shape);
        shape.owner.node.document.visual.highlighter.removeState(
            shape.owner,
            this.selectedState,
            shape.shape.shapeType,
            ...shape.indexes,
        );
    }

    private addSelected(shape: VisualShapeData) {
        shape.owner.node.document.visual.highlighter.addState(
            shape.owner,
            this.selectedState,
            this.shapeType,
            ...shape.indexes,
        );
        this._shapes.set(shape.shape, shape);
    }
}
