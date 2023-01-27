// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEventHandler, IView, IVisualizationShape } from "chili-core";

export class ThreeSelectHandler implements IEventHandler {
    private mouse: { isDown: boolean; x: number; y: number };
    private _lastDetected: IVisualizationShape | undefined;

    constructor() {
        this.mouse = { isDown: false, x: 0, y: 0 };
    }

    mouseOut(view: IView, event: MouseEvent): void {}

    mouseWheel(view: IView, event: WheelEvent): void {
        view.update();
    }

    keyUp(view: IView, event: KeyboardEvent): void {}
    touchStart(view: IView, event: TouchEvent): void {}
    touchMove(view: IView, event: TouchEvent): void {}
    touchEnd(view: IView, event: TouchEvent): void {}

    mouseMove(view: IView, event: MouseEvent): void {
        if (this._lastDetected !== undefined) {
            this._lastDetected.unHilightedState();
            this._lastDetected = undefined;
        }
        this._lastDetected = view.document.selection.detectedModel(view, event.offsetX, event.offsetY);
        this._lastDetected?.hilightedState();
        view.update();
    }

    mouseDown(view: IView, event: MouseEvent): void {
        if (event.button === 0) {
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
        }
    }

    mouseUp(view: IView, event: MouseEvent): void {
        if (this.mouse.isDown && event.button === 0) {
            view.document.selection.select(view, this.mouse.x, this.mouse.y, event.shiftKey);
            this.mouse.isDown = false;
        }
        view.document.viewer.redraw();
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
