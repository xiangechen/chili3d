// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Logger } from "chili-core";
import { Control, Label, Panel } from "../components";
import { DefaultRibbon } from "../profile/ribbon";
import { RibbonData } from "./ribbonData";
import { RibbonTab } from "./ribbonTab";
import { TitleBar } from "./titlebar";

import style from "./ribbon.module.css";

export class Ribbon extends Control {
    readonly titlebar: TitleBar = new TitleBar();
    private readonly _tabs: Array<RibbonTab> = [];
    private readonly _ribbonPanel: Panel;
    private readonly _ribbonHeader: Panel;
    private readonly startup: Label = new Label().i18nText("ribbon.tab.file").addClass(style.startup);
    private _selected?: RibbonTab;

    constructor() {
        super(style.root);
        this._ribbonHeader = new Panel().addClass(style.headerPanel).addItem(this.startup);
        this._ribbonPanel = new Panel().addClass(style.contentPanel);
        this.append(this.titlebar, this._ribbonHeader, this._ribbonPanel);

        this.initRibbon(DefaultRibbon);
        this.initQuickBar(["NewDocument", "OpenDocument", "SaveDocument", "Undo", "Redo"]);
    }

    selectTab(tab: RibbonTab) {
        if (this._selected !== undefined && this._selected !== tab) {
            this._selected.header.removeClass(style.selectedTab);
            this._ribbonPanel.clearChildren();
        }

        this._selected = tab;
        this._selected.header.addClass(style.selectedTab);
        this._ribbonPanel.append(tab);
    }

    addTab(tab: RibbonTab) {
        if (this._tabs.find((x) => x.header.textContent === tab.header.textContent)) {
            Logger.warn(`${tab.header.textContent} already exists`);
            return;
        }

        this._tabs.push(tab);
        this._ribbonHeader.append(tab.header);
        tab.header.addEventListener("click", () => {
            this.selectTab(tab);
        });

        if (this._selected === undefined) {
            this.selectTab(tab);
        }
    }

    private initRibbon(configs: RibbonData) {
        configs.forEach((config) => {
            let tab = RibbonTab.from(config);
            this.addTab(tab);
        });
    }

    private initQuickBar(buttons: string[]) {
        this.titlebar.quickToolBar.addButton(...buttons);
    }
}

customElements.define("chili-ribbon", Ribbon);
