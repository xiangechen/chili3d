// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, IEditor, IView } from "chili-core";

export class DefaultEditor implements IEditor {
    constructor(readonly entity: Entity) {}
    onPointerMove(view: IView, e: PointerEvent): void {}
    onPointerDown(view: IView, e: PointerEvent): void {}
    onPointerUp(view: IView, e: PointerEvent): void {}
    deactive(): boolean {
        return true;
    }
    active(): boolean {
        return true;
    }
}
