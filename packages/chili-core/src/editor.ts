// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IView } from "./visualization";

export interface IEditor {
    active(): boolean;
    deactive(): boolean;
    onMouseMove(view: IView, e: MouseEvent): void;
    onMouseDown(view: IView, e: MouseEvent): void;
    onMouseUp(view: IView, e: MouseEvent): void;
}
