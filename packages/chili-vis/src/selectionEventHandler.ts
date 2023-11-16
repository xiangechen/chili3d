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
    downX: number;
    downY: number;
}

export abstract class SelectionHandler implements IEventHandler {
    private rect?: SelectionRect;
    private mouse = { isDown: false, x: 0, y: 0 };
    private _selected: VisualShapeData[] | undefined;
    private _detectAtMouse: VisualShapeData[] | undefined;
    private _lockDetected: IShape | undefined; // 用于切换捕获的对象

    constructor(
        readonly document: IDocument,
        readonly shapeType: ShapeType,
        readonly multiMode: boolean,
        readonly controller?: AsyncController,
        readonly filter?: IShapeFilter,
    ) {
        controller?.onCancelled((s) => {
            this.clearSelected(document);
            this.cleanHighlights();
        });
    }

    dispose() {
        this.clearSelected(this.document);
        this._selected = undefined;
        this._detectAtMouse = undefined;
    }

    pointerMove(view: IView, event: PointerEvent): void {
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
            detecteds = detecteds.concat(
                view.rectDetected(
                    this.shapeType,
                    this.mouse.x,
                    this.mouse.y,
                    event.offsetX,
                    event.offsetY,
                    this.filter,
                ),
            );
        } else {
            this._detectAtMouse = view.detected(this.shapeType, event.offsetX, event.offsetY, this.filter);
            let detected = this.getDetecting();
            if (detected) detecteds.push(detected);
        }
        return detecteds;
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

    private setHighlight(view: IView, detecteds: VisualShapeData[]) {
        this._selected?.forEach((x) => {
            if (!detecteds.includes(x))
                x.owner.removeState(VisualState.hilight, this.shapeType, ...x.indexes);
        });
        detecteds.forEach((x) => {
            if (!this._selected?.includes(x))
                x.owner.addState(VisualState.hilight, this.shapeType, ...x.indexes);
        });
        this._selected = detecteds;
        view.viewer.update();
    }

    pointerDown(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (event.button === 0) {
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
            if (this.multiMode) this.rect = this.initRect(view.container, event);
        }
    }

    private initRect(parent: HTMLElement, event: PointerEvent): SelectionRect {
        let rect = document.createElement("div");
        rect.style.cssText = SelectionRectStyle;
        parent.appendChild(rect);
        return {
            element: rect,
            downX: event.offsetX,
            downY: event.offsetY,
        };
    }

    private updateRect(element: SelectionRect, event: PointerEvent) {
        element.element.style.display = "block";
        const x1 = Math.min(element.downX, event.offsetX);
        const y1 = Math.min(element.downY, event.offsetY);
        const x2 = Math.max(element.downX, event.offsetX);
        const y2 = Math.max(element.downY, event.offsetY);
        element.element.style.left = x1 + "px";
        element.element.style.top = y1 + "px";
        element.element.style.width = x2 - x1 + "px";
        element.element.style.height = y2 - y1 + "px";
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
            let count = this.select(view, this._selected ?? [], event);
            this.cleanHighlights();
            view.viewer.update();
            if (count > 0 && !this.multiMode) this.controller?.success();
        }
    }

    protected abstract clearSelected(document: IDocument): void;

    protected abstract select(view: IView, shapes: VisualShapeData[], event: PointerEvent): number;

    private removeRect(view: IView) {
        if (this.rect) {
            view.container.removeChild(this.rect.element);
            this.rect = undefined;
        }
    }

    private cleanHighlights() {
        this._selected?.forEach((x) => {
            x.owner.removeState(VisualState.hilight, this.shapeType);
        });
        this._selected = undefined;
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            if (this.controller) {
                this.controller.cancel();
            } else {
                this.clearSelected(view.viewer.visual.document);
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

    private highlightNext(view: IView) {
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
