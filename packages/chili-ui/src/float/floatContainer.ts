// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Div } from "../controls";
import style from "./float.module.css";

export class FloatContainer extends Div {
    constructor() {
        super(style.floatContainer);
    }
}
