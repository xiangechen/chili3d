// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, IDocument, IEventHandler, IView } from "chili-core";

const MOUSE_MIDDLE = 4;

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
    protected showRect = true;
    protected mouse = { isDown: false, x: 0, y: 0 };
    protected readonly pointerEventMap: Map<number, PointerEvent> = new Map();

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

    #disposed = false;
    readonly dispose = () => {
        if (!this.#disposed) {
            this.#disposed = true;

            this.disposeInternal();
        }
    };

    protected disposeInternal() {
        this.pointerEventMap.clear();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons === MOUSE_MIDDLE) return;
        if (this.rect) this.updateRect(this.rect, event);

        this.setHighlight(view, event);
    }

    protected abstract setHighlight(view: IView, event: PointerEvent): void;

    protected abstract cleanHighlights(): void;

    protected abstract clearSelected(document: IDocument): void;

    protected abstract select(view: IView, event: PointerEvent): number;

    protected abstract highlightNext(view: IView): void;

    pointerDown(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (event.button === 0 && event.isPrimary) {
            this.mouse = { isDown: true, x: event.offsetX, y: event.offsetY };
            if (this.multiMode && this.showRect) {
                this.rect = this.initRect(event);
            }
        }
        this.pointerEventMap.set(event.pointerId, event);
    }

    private initRect(event: PointerEvent): SelectionRect {
        const rect = document.createElement("div");
        rect.style.cssText = SelectionRectStyle;
        document.body.appendChild(rect);
        return { element: rect, clientX: event.clientX, clientY: event.clientY };
    }

    protected updateRect(rect: SelectionRect, event: PointerEvent) {
        if (this.pointerEventMap.size !== 1) return;
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
        if (event.isPrimary) {
            this.mouse.isDown = false;
            this.removeRect(view);
            this.cleanHighlights();
        }
        this.pointerEventMap.delete(event.pointerId);
    }

    pointerUp(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (this.mouse.isDown && event.button === 0 && event.isPrimary) {
            this.mouse.isDown = false;
            this.removeRect(view);
            const count = this.select(view, event);
            this.cleanHighlights();
            view.update();
            if (count > 0 && !this.multiMode) this.controller?.success();
        }
        this.pointerEventMap.delete(event.pointerId);
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
