// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IEventHandler, IView } from "chili-core";

interface MouseDownData {
    time: number;
    key: number;
}

const MIDDLE = 4;

export class ThreeViewHandler implements IEventHandler {
    private _lastDown: MouseDownData | undefined;
    private _clearDownId: number | undefined;
    private _offsetPoint: { x: number; y: number } | undefined;

    canRotate: boolean = true;

    dispose() {
        this.clearTimeout();
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.cameraController.zoom(event.offsetX, event.offsetY, event.deltaY);
        view.update();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (event.buttons !== MIDDLE) {
            return;
        }
        let [dx, dy] = [0, 0];
        if (this._offsetPoint) {
            dx = event.offsetX - this._offsetPoint.x;
            dy = event.offsetY - this._offsetPoint.y;
            this._offsetPoint = { x: event.offsetX, y: event.offsetY };
        }
        if (event.shiftKey && this.canRotate) {
            view.cameraController.rotate(dx, dy);
        } else if (!event.shiftKey) {
            view.cameraController.pan(dx, dy);
        }
        if (dx !== 0 && dy !== 0) this._lastDown = undefined;
        view.update();
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
            this._offsetPoint = { x: event.offsetX, y: event.offsetY };
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
        this._offsetPoint = undefined;
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
