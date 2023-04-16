// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { Panel } from "../components/panel";

import { DefaultRibbon } from "../profile/ribbon";
import { Ribbon } from "../ribbon";
import { RibbonData } from "../ribbon/ribbonData";
import { RibbonTab } from "../ribbon/ribbonTab";
import { Sidebar } from "../sidebar";
import { Statusbar } from "../statusbar";
import { Viewport } from "../viewport";
import style from "./ui.module.css";

/**
 * ______________________________
 * |                            |
 * |        ribbon              |
 * |____________________________|
 * |        context             |
 * |____________________________|
 * |         |                  |
 * |         |                  |
 * | sidebar |     viewport     |
 * |         |                  |
 * |         |                  |
 * |_________|__________________|
 * |         statusbar          |
 * |____________________________|
 */
export class UI {
    private static _ui: UI | undefined;

    static get instance() {
        if (UI._ui === undefined) {
            UI._ui = new UI();
        }
        return UI._ui;
    }

    readonly ribbon: Ribbon;
    readonly sidebar: HTMLElement;
    readonly statusbar: Statusbar;
    private root?: HTMLElement;

    private constructor() {
        this.ribbon = new Ribbon();
        this.sidebar = new Panel().addClass(style.sidebar).addItem(new Sidebar());
        this.statusbar = new Statusbar();
    }

    init(root: HTMLElement) {
        this.setTheme("light");
        this.root = root;
        root.focus();
        root.addEventListener("keydown", this.handleKeyDown);
        root.addEventListener("keyup", this.handleKeyUp);

        let div = new Panel().addClass(style.reactive);
        div.append(this.sidebar, Viewport.current);
        root?.append(this.ribbon, div, this.statusbar);
        root.classList.add(style.root);

        this.initRibbon(DefaultRibbon);
        this.initQuickBar(["Save", "Undo", "Redo"]);
    }

    focus() {
        this.root?.focus();
    }

    setTheme(theme: "light" | "dark") {
        let doc = document.documentElement;
        doc.setAttribute("theme", theme);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        PubSub.default.pub("keyDown", e);
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        PubSub.default.pub("keyUp", e);
    };

    private initRibbon(configs: RibbonData) {
        configs.forEach((config) => {
            let tab = RibbonTab.from(config);
            this.ribbon.addTab(tab);
        });
    }

    private initQuickBar(buttons: string[]) {
        this.ribbon.titlebar.quickToolBar.addButton(...buttons);
    }
}
