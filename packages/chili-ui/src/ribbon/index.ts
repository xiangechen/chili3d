// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { RibbonTab } from "./ribbonTab";
import { TitleBar } from "./titlebar";
import style from "./ribbon.module.css";
import { Control } from "../control";

export class Ribbon {
    readonly dom: HTMLDivElement;
    readonly titlebar: TitleBar;
    private readonly _tabs: Array<RibbonTab>;
    private readonly _ribbonPanel: HTMLDivElement;
    private readonly _ribbonHeader: HTMLDivElement;
    private readonly startup: HTMLButtonElement;
    private _selected?: RibbonTab;

    constructor() {
        this.dom = Control.div();
        this.titlebar = new TitleBar();
        this._ribbonHeader = Control.div(style.headerPanel);
        this._ribbonPanel = Control.div(style.contentPanel);
        this._tabs = new Array<RibbonTab>();
        this.startup = Control.button(
            "test",
            () => {
                "click";
            },
            style.startup
        );
        this._ribbonHeader.appendChild(this.startup);
        Control.append(this.dom, this.titlebar.dom, this._ribbonHeader, this._ribbonPanel);
    }

    selectTab(tab: RibbonTab) {
        if (this._selected !== undefined && this._selected !== tab) {
            this._selected.header.classList.remove(style.selected);
            Control.clear(this._ribbonPanel);
        }
        this._selected = tab;
        this._selected.header.classList.add(style.selected);
        this._ribbonPanel.appendChild(tab.dom);
    }

    addTab(tab: RibbonTab) {
        if (this._tabs.find((x) => x.header.textContent === tab.header.textContent)) {
            console.error(`${tab.header.textContent} already exists`);
            return;
        }
        this._tabs.push(tab);
        this._ribbonHeader.appendChild(tab.header);
        tab.header.addEventListener("click", () => {
            this.selectTab(tab);
        });

        if (this._selected === undefined) {
            this.selectTab(tab);
        }
    }
}
