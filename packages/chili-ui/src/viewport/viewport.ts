// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../control";
import style from "./viewport.module.css";

export class Viewport {
    readonly dom: HTMLDivElement;

    private constructor() {
        this.dom = Control.div(style.viewport);
    }

    private static _current: Viewport | undefined;

    static get current(): Viewport {
        if (Viewport._current === undefined) {
            Viewport._current = new Viewport();
        }
        return Viewport._current;
    }
}
