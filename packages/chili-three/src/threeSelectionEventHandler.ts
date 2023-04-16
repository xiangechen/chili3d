// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEventHandler, IView, IVisualizationShape } from "chili-core";

export class ThreeSelectHandler implements IEventHandler {
    private mouse: { isDown: boolean; x: number; y: number };
    private _lastDetected: IVisualizationShape | undefined;

    constructor() {
        this.mouse = { isDown: false, x: 0, y: 0 };
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.update();
    }

    keyUp(view: IView, event: KeyboardEvent): void {}

    pointerMove(view: IView, event: PointerEvent): void {
        if (this._lastDetected !== undefined) {
            this._lastDetected.unHilightedState();
            this._lastDetected = undefined;
        }
        this._lastDetected = view.document.visualization.selection.detectedModel(
            view,
            event.offsetX,
            event.offsetY
        );
        this._lastDetected?.hilightedState();
        view.update();
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button === 0) {
            this.mouse = {
                isDown: true,
                x: event.offsetX,
                y: event.offsetY,
            };
        }
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (this.mouse.isDown && event.button === 0) {
            view.document.visualization.selection.select(view, this.mouse.x, this.mouse.y, event.shiftKey);
            this.mouse.isDown = false;
        }
        view.document.viewer.redraw();
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
