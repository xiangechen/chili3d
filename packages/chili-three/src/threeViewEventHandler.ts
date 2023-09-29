// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IEventHandler, IView } from "chili-core";

export class ThreeViewHandler implements IEventHandler {
    private mouse: { isDown: boolean; x: number; y: number };

    constructor() {
        this.mouse = { isDown: false, x: 0, y: 0 };
    }

    dispose() {}

    mouseWheel(view: IView, event: WheelEvent): void {
        view.zoom(event.offsetX, event.offsetY, event.deltaY);
        view.redraw();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (this.mouse.isDown) {
            let dx = this.mouse.x - event.offsetX;
            let dy = event.offsetY - this.mouse.y;
            if (event.buttons === 4 && event.shiftKey) {
                view.pan(dx, dy);
            } else if (event.buttons === 4 && !event.shiftKey) {
                view.rotation(dx, dy);
            }
            this.mouse.x = event.offsetX;
            this.mouse.y = event.offsetY;
        }
        view.redraw();
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button === 1 || event.button === 2) {
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
        }
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (this.mouse.isDown && event.button === 1) {
            this.mouse.isDown = false;
        }
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
