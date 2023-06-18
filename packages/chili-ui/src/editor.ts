// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control, Panel } from "./components";
import style from "./editor.module.css";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { Ribbon } from "./ribbon";
import { Statusbar } from "./statusbar";
import { Viewport } from "./viewport";

export class Editor extends Control {
    constructor() {
        super(style.panel);
        this.append(
            new Ribbon(),
            new Panel()
                .addClass(style.content)
                .addItem(
                    new Panel()
                        .addClass(style.sidebar)
                        .addItem(
                            new ProjectView().addClass(style.sidebarItem),
                            new PropertyView().addClass(style.sidebarItem)
                        ),
                    new Viewport().addClass(style.viewport)
                ),
            new Statusbar().addClass(style.statusbar)
        );
    }
}

customElements.define("chili-editor", Editor);
