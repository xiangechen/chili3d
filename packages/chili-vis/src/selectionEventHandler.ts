// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { DetectedData, IEventHandler, IModel, IView, IVisualShape, ShapeType, VisualState } from "chili-core";

export class SelectionHandler implements IEventHandler {
    private mouse: { isDown: boolean; x: number; y: number };
    private _lastDetected: DetectedData | undefined;

    private shapeType: ShapeType = ShapeType.Shape;

    constructor() {
        this.mouse = { isDown: false, x: 0, y: 0 };
    }

    mouseWheel(view: IView, event: WheelEvent): void {
        view.redraw();
    }

    keyUp(view: IView, event: KeyboardEvent): void {}

    pointerMove(view: IView, event: PointerEvent): void {
        if (this._lastDetected !== undefined) {
            this._lastDetected?.owner.removeState(VisualState.hilight, this.shapeType);
        }
        this._lastDetected = view.detected(this.shapeType, event.offsetX, event.offsetY, true).at(0);
        this._lastDetected?.owner.addState(VisualState.hilight, this.shapeType);

        // if (view instanceof ThreeView && this.mouse.isDown) {
        //     let o = view.rectDetected(this.mouse.x, event.offsetX, this.mouse.y, event.offsetY);
        // }

        view.viewer.redraw();
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
            let intersect = view.detected(ShapeType.Shape, this.mouse.x, this.mouse.y, true).at(0);
            if (intersect === undefined) {
                view.viewer.visual.document.selection.clearSelected();
                return;
            }

            let node = view.viewer.visual.context.getModel(intersect.owner);
            if (node !== undefined) view.viewer.visual.document.selection.select([node], event.shiftKey);

            this.mouse.isDown = false;
        }
        view.viewer.redraw();
    }

    keyDown(view: IView, event: KeyboardEvent): void {}
}
