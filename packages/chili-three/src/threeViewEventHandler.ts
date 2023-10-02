// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IEventHandler, IView } from "chili-core";

interface MouseDownData {
    x: number;
    y: number;
    time: number;
    key: number;
    isDoubleClick: boolean;
}

const MIDDLE = 4;

export class ThreeViewHandler implements IEventHandler {
    private lastDown: MouseDownData | undefined;
    private _clearDownId: any;

    dispose() {}

    mouseWheel(view: IView, event: WheelEvent): void {
        view.zoom(event.offsetX, event.offsetY, event.deltaY);
        view.update();
    }

    pointerMove(view: IView, event: PointerEvent): void {
        if (this.lastDown && event.buttons === MIDDLE) {
            let dx = this.lastDown.x - event.offsetX;
            let dy = event.offsetY - this.lastDown.y;
            if (event.shiftKey) {
                view.pan(dx, dy);
            } else if (!event.shiftKey) {
                view.rotate(dx, dy);
            }
            this.lastDown.x = event.offsetX;
            this.lastDown.y = event.offsetY;
        }
        view.update();
    }

    pointerDown(view: IView, event: PointerEvent): void {
        if (this._clearDownId) {
            clearTimeout(this._clearDownId);
            this._clearDownId = undefined;
        }
        let isDoubleClick = false;
        if (this.checkDoubleClick(event)) {
            isDoubleClick = true;
            view.fitContent();
            view.update();
        }
        this.lastDown = {
            x: event.offsetX,
            y: event.offsetY,
            time: Date.now(),
            key: event.buttons,
            isDoubleClick,
        };
    }

    pointerOut(view: IView, event: PointerEvent): void {
        this.lastDown = undefined;
    }

    private checkDoubleClick(event: PointerEvent) {
        return (
            this.lastDown &&
            !this.lastDown.isDoubleClick &&
            this.lastDown.key === event.buttons &&
            this.lastDown.time + 500 > Date.now() &&
            event.buttons === MIDDLE &&
            !event.shiftKey
        );
    }

    pointerUp(view: IView, event: PointerEvent): void {
        this._clearDownId = setTimeout(() => {
            this.lastDown = undefined;
            this._clearDownId = undefined;
        }, 500);
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
