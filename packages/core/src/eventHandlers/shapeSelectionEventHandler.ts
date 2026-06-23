// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { AsyncController } from "../foundation";
import type { INodeFilter, IShapeFilter } from "../selectionFilter";
import type { IShape, ShapeType } from "../shape";
import { type IView, type VisualShapeData, type VisualState, VisualStates } from "../visual";
import { SelectionHandler } from "./selectionEventHandler";

export abstract class ShapeSelectionHandler extends SelectionHandler {
    protected _highlights: VisualShapeData[] | undefined;
    private _detectAtMouse: VisualShapeData[] | undefined;
    private _lockDetected: IShape | undefined;

    highlightState: VisualState = VisualStates.edgeHighlight;

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
            this.document.visual.highlighter.addState(
                x.owner,
                this.highlightState,
                x.shape.shapeType,
                ...x.indexes,
            );
        });
        this._highlights = detecteds;
        view.update();
    }

    protected cleanHighlights() {
        this._highlights?.forEach((x) => {
            this.document.visual.highlighter.removeState(
                x.owner,
                this.highlightState,
                x.shape.shapeType,
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
    selectedState: VisualState = VisualStates.edgeSelected;

    protected override select(view: IView, event: PointerEvent): number {
        if (!this._highlights?.length) {
            return 0;
        }

        return this.document.selection.setSelectedShapes(
            this._highlights,
            this.selectedState,
            this.multiMode,
        );
    }
}
