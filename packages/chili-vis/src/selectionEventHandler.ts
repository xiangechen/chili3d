// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEventHandler, IView, ShapeType, VisualShapeData, VisualState } from "chili-core";

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
    private _highlights: VisualShapeData[] | undefined;
    private _detects: VisualShapeData[] | undefined;
    private detectingIndex = 0; // 用于切换捕获的对象

    constructor(readonly shapeType: ShapeType, readonly multiMode: boolean = true) {}

    dispose() {
        this._highlights = undefined;
        this._detects = undefined;
    }

    pointerMove(view: IView, event: PointerEvent): void {
        // 每次鼠标移动，就将捕获对象的序号设为 0
        this.detectingIndex = 0;
        this._detects = undefined;
        if (this.rect) {
            this.updateRect(this.rect, event);
        }
        let detecteds = this.getDetecteds(view, event);
        this.setHighlight(view, detecteds);
    }

    private getDetecteds(view: IView, event: PointerEvent) {
        let detecteds: VisualShapeData[] = [];
        if (this.rect) {
            detecteds = detecteds.concat(
                view.rectDetected(this.shapeType, this.mouse.x, this.mouse.y, event.offsetX, event.offsetY)
            );
        } else {
            // 每次鼠标移动，就获得鼠标处的所有对象，用户可以通过键盘切换要选择的对象
            this._detects = view.detected(this.shapeType, event.offsetX, event.offsetY, true);
            // 获得当前 detectingIndex 下的对象
            let detected = this.getDetecting();
            if (detected) detecteds.push(detected);
        }
        return detecteds;
    }

    private getDetecting() {
        if (this._detects) {
            if (this.detectingIndex >= 0 && this.detectingIndex < this._detects.length) {
                return this._detects[this.detectingIndex];
            }
        }
        return undefined;
    }

    private setHighlight(view: IView, detecteds: VisualShapeData[]) {
        this._highlights?.forEach((x) => {
            if (!detecteds.includes(x)) x.owner.removeState(VisualState.hilight, this.shapeType);
        });
        detecteds.forEach((x) => {
            if (!this._highlights?.includes(x)) x.owner.addState(VisualState.hilight, this.shapeType);
        });
        this._highlights = detecteds;
        view.viewer.redraw();
    }

    pointerDown(view: IView, event: PointerEvent): void {
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
            downX: event.clientX,
            downY: event.clientY,
        };
    }

    private updateRect(element: SelectionRect, event: PointerEvent) {
        element.element.style.display = "block";
        const x1 = Math.min(element.downX, event.clientX);
        const y1 = Math.min(element.downY, event.clientY);
        const x2 = Math.max(element.downX, event.clientX);
        const y2 = Math.max(element.downY, event.clientY);
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
        if (this.mouse.isDown && event.button === 0) {
            this.mouse.isDown = false;
            this.removeRect(view);
            this.select(view, this._highlights ?? [], event);
        }
        this.cleanHighlights();
        view.viewer.redraw();
    }

    protected abstract select(view: IView, highlights: VisualShapeData[], event: PointerEvent): void;

    private removeRect(view: IView) {
        if (this.rect) {
            view.container.removeChild(this.rect.element);
            this.rect = undefined;
        }
    }

    private cleanHighlights() {
        this._highlights?.forEach((x) => {
            x.owner.removeState(VisualState.hilight, this.shapeType);
        });
        this._highlights = undefined;
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.cleanHighlights();
            view.viewer.visual.document.selection.clearSelected();
        } else if (event.key === "Tab") {
            event.preventDefault();
            this.highlightNext(view);
        }
    }

    private highlightNext(view: IView) {
        if (this._detects) {
            if (this._detects.length - 1 > this.detectingIndex) {
                this.detectingIndex++;
            } else if (this.detectingIndex !== 0) {
                this.detectingIndex = 0;
            }
            let detected = this.getDetecting();
            if (detected) this.setHighlight(view, [detected]);
        }
    }
}
