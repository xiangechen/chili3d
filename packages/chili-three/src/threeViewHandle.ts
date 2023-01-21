// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEventHandler, IView } from "chili-core";

document.oncontextmenu = (e) => e.preventDefault();

export class ThreeViewHandler implements IEventHandler {
    private mouse: { isDown: boolean; x: number; y: number };

    constructor() {
        this.mouse = { isDown: false, x: 0, y: 0 };
    }

    mouseOut(view: IView, event: MouseEvent): void {}

    mouseWheel(view: IView, event: WheelEvent): void {
        view.zoom(event.offsetX, event.offsetY, event.deltaY);
    }

    keyUp(view: IView, event: KeyboardEvent): void {}
    touchStart(view: IView, event: TouchEvent): void {}
    touchMove(view: IView, event: TouchEvent): void {}
    touchEnd(view: IView, event: TouchEvent): void {}

    mouseMove(view: IView, event: MouseEvent): void {
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
        view.update();
    }

    mouseDown(view: IView, event: MouseEvent): void {
        if (event.button === 1 || event.button === 2) {
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
        }
    }

    mouseUp(view: IView, event: MouseEvent): void {
        if (this.mouse.isDown && event.button === 1) {
            this.mouse.isDown = false;
        }
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
