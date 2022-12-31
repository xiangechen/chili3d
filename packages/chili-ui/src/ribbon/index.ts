// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Button, Div } from "../controls";
import { RibbonTab } from "./ribbonTab";
import { TitleBar } from "./titlebar";
import style from "./ribbon.module.css";

export class Ribbon extends Div {
    readonly titlebar: TitleBar;
    private readonly _tabs: Array<RibbonTab>;
    private readonly _ribbonPanel: Div;
    private readonly _ribbonHeader: Div;
    private readonly startup: Button;
    private _selected?: RibbonTab;

    constructor() {
        super();
        this.titlebar = new TitleBar();
        this._ribbonHeader = new Div(style.headerPanel);
        this._ribbonPanel = new Div(style.contentPanel);
        this._tabs = new Array<RibbonTab>();
        this.startup = new Button(
            "test",
            () => {
                "click";
            },
            style.startup
        );
        this._ribbonHeader.add(this.startup);
        this.add(this.titlebar, this._ribbonHeader, this._ribbonPanel);
    }

    selectTab(tab: RibbonTab) {
        if (this._selected !== undefined && this._selected !== tab) {
            this._selected.header.removeClass(style.selected);
            this._ribbonPanel.clear();
        }
        this._selected = tab;
        this._selected.header.addClass(style.selected);
        this._ribbonPanel.dom.appendChild(tab.dom);
    }

    addTab(tab: RibbonTab) {
        if (this._tabs.find((x) => x.header.text === tab.header.text)) {
            console.error(`${tab.header.text} already exists`);
            return;
        }
        this._tabs.push(tab);
        this._ribbonHeader.add(tab.header);
        tab.header.dom.addEventListener("click", () => {
            this.selectTab(tab);
        });

        if (this._selected === undefined) {
            this.selectTab(tab);
        }
    }
}
