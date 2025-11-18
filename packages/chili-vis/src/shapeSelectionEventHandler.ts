// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type INodeFilter,
    type IShape,
    type IShapeFilter,
    type IView,
    type ShapeType,
    type VisualShapeData,
    VisualState,
} from "chili-core";
import { SelectionHandler } from "./selectionEventHandler";

export abstract class ShapeSelectionHandler extends SelectionHandler {
    protected _highlights: VisualShapeData[] | undefined;
    private _detectAtMouse: VisualShapeData[] | undefined;
    private _lockDetected: IShape | undefined;

    highlightState = VisualState.edgeHighlight;

    constructor(
        document: IDocument,
        readonly shapeType: ShapeType,
        multiMode: boolean,
        controller?: AsyncController,
        readonly shapefilter?: IShapeFilter,
        readonly nodeFilter?: INodeFilter,
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
                this.shapefilter,
                this.nodeFilter,
            );
        }
        this._detectAtMouse = view.detectShapes(
            this.shapeType,
            event.offsetX,
            event.offsetY,
            this.shapefilter,
            this.nodeFilter,
        );
        const detected = this.getDetecting();
        return detected ? [detected] : [];
    }

    protected override setHighlight(view: IView, event: PointerEvent) {
        const detecteds = this.getDetecteds(view, event);
        this.highlightDetecteds(view, detecteds);
    }

    protected highlightDetecteds(view: IView, detecteds: VisualShapeData[]) {
        this.cleanHighlights();
        detecteds.forEach((x) => {
            view.document.visual.highlighter.addState(
                x.owner,
                this.highlightState,
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
                this.highlightState,
                this.shapeType,
                ...x.indexes,
            );
        });
        this._highlights = undefined;
    }

    protected highlightNext(view: IView) {
        if (this._detectAtMouse && this._detectAtMouse.length > 1) {
            const index = this._lockDetected
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
        nodeFilter?: INodeFilter,
    ) {
        super(document, shapeType, multiMode, controller, filter, nodeFilter);
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
