// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../control";
import { RibbonTab } from "../ribbon/ribbonTab";
import style from "./ui.module.css";
import { Sidebar } from "../sidebar";
import { Viewport } from "../viewport";
import { PubSub } from "chili-core";
import { Ribbon } from "../ribbon";
import { Statusbar } from "../statusbar";
import { RibbonData } from "../ribbon/ribbonData";
import { Contextual } from "../contextual";

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
    readonly sidebar: Sidebar;
    readonly statusbar: Statusbar;
    private root?: HTMLElement;

    private constructor() {
        this.ribbon = new Ribbon();
        this.sidebar = new Sidebar();
        this.statusbar = new Statusbar();
    }

    init(root: HTMLElement, ribbon: RibbonData, quickbar: string[]) {
        this.setTheme("light");
        this.root = root;
        root.focus();
        root.addEventListener("keydown", this.handleKeyDown);
        root.addEventListener("keyup", this.handleKeyUp);

        let div = Control.div(style.reactive);
        Control.append(div, this.sidebar.dom, Viewport.current.dom);
        root?.appendChild(this.ribbon.dom);
        Contextual.instance.init(this.root);
        root?.appendChild(div);
        root?.appendChild(this.statusbar.dom);
        root.classList.add(style.root);

        this.sidebar.dom.classList.add(style.sidebar);

        this.initRibbon(ribbon);
        this.initQuickBar(quickbar);
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
            let tab = RibbonTab.from(config, this.handleCommand.bind(this));
            this.ribbon.addTab(tab);
        });
    }

    private initQuickBar(buttons: string[]) {
        this.ribbon.titlebar.quickToolBar.fromConfig(buttons, this.handleCommand.bind(this));
    }

    private handleCommand(commandName: string) {
        PubSub.default.pub("excuteCommand", commandName as any);
    }
}
