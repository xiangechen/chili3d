// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Div } from "../controls";
import style from "./viewport.module.css";

export class Viewport extends Div {
    private constructor() {
        super(style.viewport);
    }

    private static _current: Viewport | undefined;

    static get current(): Viewport {
        if (Viewport._current === undefined) {
            Viewport._current = new Viewport();
        }
        return Viewport._current;
    }
}
