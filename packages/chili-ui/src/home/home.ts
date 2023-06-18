// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IStorage } from "chili-core";
import { Control, Label, Panel, Row } from "../components";
import style from "./home.module.css";

export class Home extends Control {
    constructor(readonly storage: IStorage) {
        super(style.panel);
        this.append(
            new Row(new Label().text(`Welcome to Chili 3D`).addClass(style.welcome)).addClass(style.header),
            new Panel().addClass(style.content)
        );
    }
}

customElements.define("chili-home", Home);
