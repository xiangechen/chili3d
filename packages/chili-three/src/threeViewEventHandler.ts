// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IEventHandler, IView } from "chili-core";

interface MouseDownData {
    time: number;
    key: number;
}

const MIDDLE = 4;

export class ThreeViewHandler implements IEventHandler {
    private _lastDown: MouseDownData | undefined;
    private _clearDownId: number | undefined;

    canRotate: boolean = true;

    dispose() {
        this.clearTimeout();
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.cameraController.zoom(event.offsetX, event.offsetY, event.deltaY);
        view.update();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons === MIDDLE) {
            if (event.shiftKey && this.canRotate) {
                view.cameraController.rotate(event.movementX, event.movementY);
            } else if (!event.shiftKey) {
                view.cameraController.pan(event.movementX, event.movementY);
            }
            if (event.movementX !== 0 && event.movementY !== 0) this._lastDown = undefined;
            view.update();
        }
    }

    pointerDown(view: IView, event: PointerEvent): void {
        this.clearTimeout();
        if (this._lastDown && this._lastDown.time + 500 > Date.now() && event.buttons === MIDDLE) {
            this._lastDown = undefined;
            view.cameraController.fitContent();
            view.update();
        } else if (event.buttons === MIDDLE) {
            view.cameraController.startRotate(event.offsetX, event.offsetY);
            this._lastDown = {
                time: Date.now(),
                key: event.buttons,
            };
        }
    }

    private clearTimeout() {
        if (this._clearDownId) {
            clearTimeout(this._clearDownId);
            this._clearDownId = undefined;
        }
    }

    pointerOut(view: IView, event: PointerEvent): void {
        this._lastDown = undefined;
    }

    pointerUp(view: IView, event: PointerEvent): void {
        if (event.buttons === MIDDLE && this._lastDown) {
            this._clearDownId = window.setTimeout(() => {
                this._lastDown = undefined;
                this._clearDownId = undefined;
            }, 500);
        }
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
