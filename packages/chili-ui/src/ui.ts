// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Lazy, PubSub } from "chili-core";
import { Panel } from "./components";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { Ribbon } from "./ribbon";
import { Statusbar } from "./statusbar";
import { Viewport } from "./viewport";

import style from "./ui.module.css";

export class UI {
    private static readonly _lazy = new Lazy(() => new UI());

    static get instance() {
        return this._lazy.value;
    }

    private constructor() {}

    init(root: HTMLElement) {
        this.setTheme("light");
        root.className = style.root;
        this.appendComponents(root);
    }

    private appendComponents(root: HTMLElement) {
        root.append(
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

    setTheme(theme: "light" | "dark") {
        let doc = document.documentElement;
        doc.setAttribute("theme", theme);
    }
}
