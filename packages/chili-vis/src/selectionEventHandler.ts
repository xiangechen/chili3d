// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { VisualShapeData, IEventHandler, IModel, IView, ShapeType, VisualState } from "chili-core";

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

export class SelectionHandler implements IEventHandler {
    private rect?: SelectionRect;
    private mouse = { isDown: false, x: 0, y: 0 };
    private _lastHighlights: VisualShapeData[] | undefined;
    private _detecting: VisualShapeData[] | undefined;
    private shapeType: ShapeType = ShapeType.Shape;
    private detectedIndex = 0;

    pointerMove(view: IView, event: PointerEvent): void {
        this.detectedIndex = 0;
        this._detecting = undefined;
        if (this.rect) {
            this.updateRect(this.rect, event);
        }
        let detecteds = this.getDetecteds(view, event);
        this.setHighlight(view, detecteds);
    }

    private getDetecteds(view: IView, event: PointerEvent) {
        let detecteds: VisualShapeData[] = [];
        if (this.mouse.isDown) {
            detecteds = detecteds.concat(
                view.rectDetected(this.shapeType, this.mouse.x, this.mouse.y, event.offsetX, event.offsetY)
            );
        } else {
            this._detecting = view.detected(this.shapeType, event.offsetX, event.offsetY, true);
            let detected = this.getPointDetecting();
            if (detected) detecteds.push(detected);
        }
        return detecteds;
    }

    private getPointDetecting() {
        if (this._detecting) {
            if (this.detectedIndex >= 0 && this.detectedIndex < this._detecting.length) {
                return this._detecting[this.detectedIndex];
            }
        }
        return undefined;
    }

    private setHighlight(view: IView, detecteds: VisualShapeData[]) {
        this._lastHighlights?.forEach((x) => {
            if (!detecteds.includes(x)) x.owner.removeState(VisualState.hilight, this.shapeType);
        });
        detecteds.forEach((x) => {
            if (!this._lastHighlights?.includes(x)) x.owner.addState(VisualState.hilight, this.shapeType);
        });
        this._lastHighlights = detecteds;
        view.viewer.redraw();
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button === 0) {
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
            this.rect = this.initRect(view.container, event);
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
        this.cleanDetecteds();
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (this.mouse.isDown && event.button === 0) {
            this.mouse.isDown = false;
            this.removeRect(view);
            this.setSelected(view, event);
        }
        this.cleanDetecteds();
        view.viewer.redraw();
    }

    private setSelected(view: IView, event: PointerEvent) {
        if (this._lastHighlights === undefined || this._lastHighlights.length === 0) {
            view.viewer.visual.document.selection.clearSelected();
        } else {
            let nodes: IModel[] = [];
            this._lastHighlights.forEach((x) => {
                let model = view.viewer.visual.context.getModel(x.owner);
                if (model) nodes.push(model);
            });
            view.viewer.visual.document.selection.select(nodes, event.shiftKey);
        }
    }

    private removeRect(view: IView) {
        if (this.rect) {
            view.container.removeChild(this.rect.element);
            this.rect = undefined;
        }
    }

    private cleanDetecteds() {
        this._lastHighlights?.forEach((x) => {
            x.owner.removeState(VisualState.hilight, this.shapeType);
        });
        this._lastHighlights = undefined;
    }

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            this.cleanDetecteds();
            view.viewer.visual.document.selection.clearSelected();
        } else if (event.key === "Tab") {
            event.preventDefault();
            this.highlightNext(view);
        }
    }

    private highlightNext(view: IView) {
        if (this._detecting) {
            if (this._detecting.length - 1 > this.detectedIndex) {
                this.detectedIndex++;
            } else if (this.detectedIndex !== 0) {
                this.detectedIndex = 0;
            }
            let detected = this.getPointDetecting();
            if (detected) this.setHighlight(view, [detected]);
        }
    }
}
