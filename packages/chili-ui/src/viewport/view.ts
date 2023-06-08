// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../components";
import style from "./view.module.css";

export class ViewControl extends Control {
    constructor() {
        super(style.view);
    }
}

customElements.define("chili-view-control", ViewControl);
