// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Lazy, PubSub } from "chili-core";
import { Panel } from "./components";
import { Ribbon } from "./ribbon";
import { Viewport } from "./viewport";
import { Statusbar } from "./statusbar";
import { ProjectView } from "./project";
import { PropertyView } from "./property";

import style from "./ui.module.css";

export class UI {
    private static readonly _lazy = new Lazy(() => new UI());

    static get instance() {
        return this._lazy.value;
    }

    private constructor() {}

    init(root: HTMLElement) {
        this.setTheme("light");
        this.initRoot(root);
        this.appendComponents(root);
    }

    private initRoot(root: HTMLElement) {
        root.focus();
        root.className = style.root;
        root.addEventListener("keydown", this.handleKeyDown);
        root.addEventListener("keyup", this.handleKeyUp);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        PubSub.default.pub("keyDown", e);
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        PubSub.default.pub("keyUp", e);
    };

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
