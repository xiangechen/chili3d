// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type FloatPanelOptions, type IDocument, Localize, PubSub } from "@chili3d/core";
import { div, label, svg } from "@chili3d/element";
import style from "./floatPanel.module.css";

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 200;
const DEFAULT_MIN_WIDTH = 150;
const DEFAULT_MIN_HEIGHT = 100;

export class FloatPanel extends HTMLElement {
    private header: HTMLElement;
    private resizeHandle: HTMLElement;
    private isDragging = false;
    private isResizing = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private initialLeft = 0;
    private initialTop = 0;
    private initialWidth = 0;
    private initialHeight = 0;

    constructor(options: FloatPanelOptions) {
        super();
        this.className = style.root;
        this.style.left = `${options.x ?? 20}px`;
        this.style.top = `${options.y ?? 20}px`;
        this.style.width = `${options.width ?? DEFAULT_WIDTH}px`;
        this.style.height = `${options.height ?? DEFAULT_HEIGHT}px`;
        this.style.minWidth = `${options.minWidth ?? DEFAULT_MIN_WIDTH}px`;
        this.style.minHeight = `${options.minHeight ?? DEFAULT_MIN_HEIGHT}px`;

        this.header = this.createHeader(options);
        this.resizeHandle = div({ className: style.resizeHandle });

        const content = div({ className: style.content }, options.content);
        this.append(this.header, content, this.resizeHandle);

        this.header.addEventListener("pointerdown", this.onHeaderPointerDown);
        this.resizeHandle.addEventListener("pointerdown", this.onResizeHandlePointerDown);

        // Intercept keyboard events to prevent bubbling to window and triggering global shortcuts
        this.tabIndex = -1;
        this.addEventListener("keydown", this.handleKeyEvent);
    }

    private createHeader(options: FloatPanelOptions): HTMLElement {
        return div(
            { className: style.header },
            div({ className: style.title }, label({ textContent: new Localize(options.title) })),
            div({ className: style.actions }, ...(options.actions ?? [])),
            div(
                {
                    className: style.closeButton,
                    onclick: () => {
                        try {
                            options.onClose?.();
                        } finally {
                            this.remove();
                            this.dispose();
                        }
                    },
                },
                svg({
                    icon: "icon-times",
                }),
            ),
        );
    }

    private onHeaderPointerDown = (e: PointerEvent): void => {
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest(`.${style.closeButton}`)) {
            return;
        }

        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        const rect = this.getBoundingClientRect();
        this.initialLeft = rect.left;
        this.initialTop = rect.top;

        document.addEventListener("pointermove", this.onDrag);
        document.addEventListener("pointerup", this.onDragEnd);
        document.addEventListener("pointercancel", this.onDragEnd);
        e.preventDefault();
    };

    private onDrag = (e: PointerEvent): void => {
        if (!this.isDragging) return;

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.style.left = `${this.initialLeft + dx}px`;
        this.style.top = `${this.initialTop + dy}px`;
    };

    private onDragEnd = (): void => {
        this.isDragging = false;
        document.removeEventListener("pointermove", this.onDrag);
        document.removeEventListener("pointerup", this.onDragEnd);
        document.removeEventListener("pointercancel", this.onDragEnd);
    };

    private onResizeHandlePointerDown = (e: PointerEvent): void => {
        this.isResizing = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        const rect = this.getBoundingClientRect();
        this.initialWidth = rect.width;
        this.initialHeight = rect.height;

        document.addEventListener("pointermove", this.onResize);
        document.addEventListener("pointerup", this.onResizeEnd);
        document.addEventListener("pointercancel", this.onResizeEnd);
        e.preventDefault();
        e.stopPropagation();
    };

    private onResize = (e: PointerEvent): void => {
        if (!this.isResizing) return;

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        const minWidth = parseInt(this.style.minWidth) || DEFAULT_MIN_WIDTH;
        const minHeight = parseInt(this.style.minHeight) || DEFAULT_MIN_HEIGHT;

        this.style.width = `${Math.max(minWidth, this.initialWidth + dx)}px`;
        this.style.height = `${Math.max(minHeight, this.initialHeight + dy)}px`;
    };

    private onResizeEnd = (): void => {
        this.isResizing = false;
        document.removeEventListener("pointermove", this.onResize);
        document.removeEventListener("pointerup", this.onResizeEnd);
        document.removeEventListener("pointercancel", this.onResizeEnd);
    };

    private handleKeyEvent = (e: KeyboardEvent): void => {
        e.stopImmediatePropagation();
    };

    dispose(): void {
        this.removeEventListener("keydown", this.handleKeyEvent);
        this.header.removeEventListener("pointerdown", this.onHeaderPointerDown);
        this.resizeHandle.removeEventListener("pointerdown", this.onResizeHandlePointerDown);
        document.removeEventListener("pointermove", this.onDrag);
        document.removeEventListener("pointerup", this.onDragEnd);
        document.removeEventListener("pointercancel", this.onDragEnd);
        document.removeEventListener("pointermove", this.onResize);
        document.removeEventListener("pointerup", this.onResizeEnd);
        document.removeEventListener("pointercancel", this.onResizeEnd);
    }
}

customElements.define("chili-float-panel", FloatPanel);

export function showFloatPanel(options: FloatPanelOptions): FloatPanel {
    let stopWatching: () => void = () => {};
    const panel = new FloatPanel({
        ...options,
        onClose: () => {
            stopWatching();
            options.onClose?.();
        },
    });
    const host = app.mainWindow ?? document.body;
    host.appendChild(panel);

    // A panel bound to a document closes with it: `Document.close` disposes the state the
    // panel reads and writes, and one left up throws out of its next edit. Closing the panel
    // first has to stop the watch, or every open would leave a subscription holding the
    // removed panel alive.
    const boundDocument = options.document;
    if (boundDocument !== undefined) {
        const handleDocumentClosed = (closed: IDocument) => {
            if (closed !== boundDocument) return;
            stopWatching();
            panel.remove();
            panel.dispose();
        };
        PubSub.default.sub("documentClosed", handleDocumentClosed);
        stopWatching = () => PubSub.default.remove("documentClosed", handleDocumentClosed);
    }
    return panel;
}
