// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    IDocument,
    IEventHandler,
    IShape,
    IShapeFilter,
    IView,
    ShapeType,
    VisualShapeData,
    VisualState,
} from "chili-core";

const SelectionRectStyle = `
    border: 1px solid #55aaff;
    background-color: rgba(75, 160, 255, 0.3);
    position: absolute;
    pointer-events: none;
    display: none;
    left: 0px;
    right: 0px;
    width: 0px;
    height: 0px;
`;

interface SelectionRect {
    element: HTMLElement;
    clientX: number;
    clientY: number;
}

export abstract class SelectionHandler implements IEventHandler {
    protected rect?: SelectionRect;
    protected mouse = { isDown: false, x: 0, y: 0 };

    constructor(
        readonly document: IDocument,
        readonly multiMode: boolean,
        readonly controller?: AsyncController,
    ) {
        controller?.onCancelled((s) => {
            this.clearSelected(document);
            this.cleanHighlights();
        });
    }

    dispose() {}

    abstract pointerMove(view: IView, event: PointerEvent): void;

    protected abstract cleanHighlights(): void;

    protected abstract clearSelected(document: IDocument): void;

    protected abstract select(view: IView, event: PointerEvent): number;

    protected abstract highlightNext(view: IView): void;

    pointerDown(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (event.button === 0) {
            this.mouse = { isDown: true, x: event.offsetX, y: event.offsetY };
            if (this.multiMode) this.rect = this.initRect(event);
        }
    }

    private initRect(event: PointerEvent): SelectionRect {
        const rect = document.createElement("div");
        rect.style.cssText = SelectionRectStyle;
        document.body.appendChild(rect);
        return { element: rect, clientX: event.clientX, clientY: event.clientY };
    }

    protected updateRect(rect: SelectionRect, event: PointerEvent) {
        rect.element.style.display = "block";
        const [x1, y1] = [Math.min(rect.clientX, event.clientX), Math.min(rect.clientY, event.clientY)];
        const [x2, y2] = [Math.max(rect.clientX, event.clientX), Math.max(rect.clientY, event.clientY)];
        Object.assign(rect.element.style, {
            left: `${x1}px`,
            top: `${y1}px`,
            width: `${x2 - x1}px`,
            height: `${y2 - y1}px`,
        });
    }

    pointerOut(view: IView, event: PointerEvent): void {
        this.mouse.isDown = false;
        this.removeRect(view);
        this.cleanHighlights();
    }

    pointerUp(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (this.mouse.isDown && event.button === 0) {
            this.mouse.isDown = false;
            this.removeRect(view);
            const count = this.select(view, event);
            this.cleanHighlights();
            view.update();
            if (count > 0 && !this.multiMode) this.controller?.success();
        }
    }

    private removeRect(view: IView) {
        this.rect?.element.remove();
        this.rect = undefined;
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.controller ? this.controller.cancel() : this.clearSelected(view.document.visual.document);
            this.cleanHighlights();
        } else if (event.key === "Enter") {
            this.cleanHighlights();
            this.controller?.success();
        } else if (event.key === "Tab") {
            event.preventDefault();
            this.highlightNext(view);
        }
    }
}

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

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons === 4) return;
        this._detectAtMouse = undefined;
        if (this.rect) this.updateRect(this.rect, event);
        const detecteds = this.getDetecteds(view, event);
        this.setHighlight(view, detecteds);
    }

    private getDetecteds(view: IView, event: PointerEvent) {
        if (this.rect && this.mouse.x !== event.offsetX && this.mouse.y !== event.offsetY) {
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

    protected setHighlight(view: IView, detecteds: VisualShapeData[]) {
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
            x.owner.geometryNode.document.visual.highlighter.removeState(
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
            if (detected) this.setHighlight(view, [detected]);
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
