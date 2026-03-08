// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type FloatPanelOptions, getCurrentApplication, Localize } from "@chili3d/core";
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

        this.header.addEventListener("mousedown", this.onHeaderMouseDown);
        this.resizeHandle.addEventListener("mousedown", this.onResizeHandleMouseDown);
    }

    private createHeader(options: FloatPanelOptions): HTMLElement {
        return div(
            { className: style.header },
            div({ className: style.title }, label({ textContent: new Localize(options.title) })),
            div(
                {
                    className: style.closeButton,
                    onclick: () => {
                        options.onClose?.();
                        this.remove();
                        this.dispose();
                    },
                },
                svg({
                    icon: "icon-times",
                }),
            ),
        );
    }

    private onHeaderMouseDown = (e: MouseEvent): void => {
        if ((e.target as HTMLElement).classList.contains(style.closeButton)) {
            return;
        }

        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        const rect = this.getBoundingClientRect();
        this.initialLeft = rect.left;
        this.initialTop = rect.top;

        document.addEventListener("mousemove", this.onDrag);
        document.addEventListener("mouseup", this.onDragEnd);
        e.preventDefault();
    };

    private onDrag = (e: MouseEvent): void => {
        if (!this.isDragging) return;

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.style.left = `${this.initialLeft + dx}px`;
        this.style.top = `${this.initialTop + dy}px`;
    };

    private onDragEnd = (): void => {
        this.isDragging = false;
        document.removeEventListener("mousemove", this.onDrag);
        document.removeEventListener("mouseup", this.onDragEnd);
    };

    private onResizeHandleMouseDown = (e: MouseEvent): void => {
        this.isResizing = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        const rect = this.getBoundingClientRect();
        this.initialWidth = rect.width;
        this.initialHeight = rect.height;

        document.addEventListener("mousemove", this.onResize);
        document.addEventListener("mouseup", this.onResizeEnd);
        e.preventDefault();
        e.stopPropagation();
    };

    private onResize = (e: MouseEvent): void => {
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
        document.removeEventListener("mousemove", this.onResize);
        document.removeEventListener("mouseup", this.onResizeEnd);
    };

    dispose(): void {
        this.header.removeEventListener("mousedown", this.onHeaderMouseDown);
        this.resizeHandle.removeEventListener("mousedown", this.onResizeHandleMouseDown);
        document.removeEventListener("mousemove", this.onDrag);
        document.removeEventListener("mouseup", this.onDragEnd);
        document.removeEventListener("mousemove", this.onResize);
        document.removeEventListener("mouseup", this.onResizeEnd);
    }
}

customElements.define("chili-float-panel", FloatPanel);

export function showFloatPanel(options: FloatPanelOptions): FloatPanel {
    const panel = new FloatPanel(options);
    const host = getCurrentApplication()?.mainWindow ?? document.body;
    host.appendChild(panel);
    return panel;
}
