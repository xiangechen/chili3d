// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEventHandler, IView } from "chili-core";

document.oncontextmenu = (e) => e.preventDefault();

export class ThreeViewHandler implements IEventHandler {
    private mouse: { isDown: boolean; x: number; y: number };

    constructor() {
        this.mouse = { isDown: false, x: 0, y: 0 };
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.zoom(event.offsetX, event.offsetY, event.deltaY);
    }

    keyUp(view: IView, event: KeyboardEvent): void {}

    pointerMove(view: IView, event: PointerEvent): void {
        event.preventDefault();
        if (this.mouse.isDown) {
            let dx = this.mouse.x - event.offsetX;
            let dy = event.offsetY - this.mouse.y;
            if (event.buttons === 4) {
                view.pan(dx, dy);
            } else if (event.buttons === 2) {
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
