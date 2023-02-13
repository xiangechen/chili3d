// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, IEditor, IView } from "chili-core";

export class DefaultEditor implements IEditor {
    constructor(readonly entity: Entity) {}
    onMouseMove(view: IView, e: MouseEvent): void {}
    onMouseDown(view: IView, e: MouseEvent): void {}
    onMouseUp(view: IView, e: MouseEvent): void {}
    deactive(): boolean {
        return true;
    }
    active(): boolean {
        return true;
    }
}
