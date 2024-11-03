// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
            if (this.multiMode) this.rect = this.initRect(event);
        }
    }

    private initRect(event: PointerEvent): SelectionRect {
        let rect = document.createElement("div");
        rect.style.cssText = SelectionRectStyle;
        document.body.appendChild(rect);
        return {
            element: rect,
            clientX: event.clientX,
            clientY: event.clientY,
        };
    }

    protected updateRect(rect: SelectionRect, event: PointerEvent) {
        rect.element.style.display = "block";
        const x1 = Math.min(rect.clientX, event.clientX);
        const y1 = Math.min(rect.clientY, event.clientY);
        const x2 = Math.max(rect.clientX, event.clientX);
        const y2 = Math.max(rect.clientY, event.clientY);
        rect.element.style.left = x1 + "px";
        rect.element.style.top = y1 + "px";
        rect.element.style.width = x2 - x1 + "px";
        rect.element.style.height = y2 - y1 + "px";
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
            let count = this.select(view, event);
            this.cleanHighlights();
            view.update();
            if (count > 0 && !this.multiMode) this.controller?.success();
        }
    }

    private removeRect(view: IView) {
        if (this.rect) {
            this.rect.element.remove();
            this.rect = undefined;
        }
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            if (this.controller) {
                this.controller.cancel();
            } else {
                this.clearSelected(view.document.visual.document);
                this.cleanHighlights();
            }
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
    private _lockDetected: IShape | undefined; // 用于切换捕获的对象

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
        if (event.buttons === 4) {
            return;
        }
        this._detectAtMouse = undefined;
        if (this.rect) {
            this.updateRect(this.rect, event);
        }
        let detecteds = this.getDetecteds(view, event);
        this.setHighlight(view, detecteds);
    }

    private getDetecteds(view: IView, event: PointerEvent) {
        let detecteds: VisualShapeData[] = [];
        if (this.rect && this.mouse.x !== event.offsetX && this.mouse.y !== event.offsetY) {
            detecteds = view.detectShapesRect(
                this.shapeType,
                this.mouse.x,
                this.mouse.y,
                event.offsetX,
                event.offsetY,
                this.filter,
            );
        } else {
            this._detectAtMouse = view.detectShapes(
                this.shapeType,
                event.offsetX,
                event.offsetY,
                this.filter,
            );
            let detected = this.getDetecting();
            if (detected) detecteds.push(detected);
        }
        return detecteds;
    }

    protected setHighlight(view: IView, detecteds: VisualShapeData[]) {
        this.cleanHighlights();
        detecteds.forEach((x) => {
            view.document.visual.highlighter.addState(
                x.owner,
                VisualState.highlighter,
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
                VisualState.highlighter,
                this.shapeType,
                ...x.indexes,
            );
        });
        this._highlights = undefined;
    }

    protected highlightNext(view: IView) {
        if (this._detectAtMouse && this._detectAtMouse.length > 1) {
            let index = 1;
            if (this._lockDetected) {
                let detecting = this.getDetcedtingIndex();
                if (detecting !== -1)
                    index = detecting === this._detectAtMouse.length - 1 ? 0 : detecting + 1;
            }
            this._lockDetected = this._detectAtMouse[index].shape;
            let detected = this.getDetecting();
            if (detected) this.setHighlight(view, [detected]);
        }
    }

    private getDetecting() {
        if (this._detectAtMouse) {
            let index = 0;
            if (this._lockDetected) {
                let loked = this.getDetcedtingIndex();
                if (loked >= 0) index = loked;
            }
            return this._detectAtMouse[index];
        }
        return undefined;
    }

    private getDetcedtingIndex() {
        if (!this._detectAtMouse) return -1;
        for (let i = 0; i < this._detectAtMouse.length; i++) {
            if (this._lockDetected === this._detectAtMouse[i].shape) {
                return i;
            }
        }
        return -1;
    }
}
