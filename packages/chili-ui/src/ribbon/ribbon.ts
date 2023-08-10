// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, ICommand, Logger, PubSub } from "chili-core";
import { Control, Label, Panel } from "../components";
import { DefaultRibbon } from "../profile/ribbon";
import { CommandContextTab } from "./commandContextTab";
import style from "./ribbon.module.css";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonData } from "./ribbonData";
import { RibbonGroup } from "./ribbonGroup";
import { RibbonTab } from "./ribbonTab";
import { TitleBar } from "./titlebar";

export class Ribbon extends Control {
    readonly titlebar: TitleBar = new TitleBar();
    private readonly _tabs: Array<RibbonTab> = [];
    private readonly _ribbonPanel: Panel;
    private readonly _ribbonHeader: Panel;
    private readonly startup: Label = new Label().i18nText("ribbon.tab.file").addClass(style.startup);
    private _selected?: RibbonTab;
    private _selectionControl?: RibbonGroup;
    private _contextTab?: RibbonTab;
    private _preSelectedTab?: RibbonTab;

    constructor() {
        super(style.root);
        this._ribbonHeader = new Panel().addClass(style.headerPanel).addItem(this.startup);
        this._ribbonPanel = new Panel().addClass(style.contentPanel);
        this.append(this.titlebar, this._ribbonHeader, this._ribbonPanel);

        this.initRibbon(DefaultRibbon);
        this.initQuickBar([/*"NewDocument", "OpenDocument",*/ "SaveDocument", "Undo", "Redo"]);

        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.sub("openContextTab", this.openContextTab);
        PubSub.default.sub("closeContextTab", this.closeContextTab);
    }

    override dispose(): void {
        super.dispose();
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("openContextTab", this.openContextTab);
        PubSub.default.remove("closeContextTab", this.closeContextTab);
    }

    private openContextTab = (command: ICommand) => {
        this._preSelectedTab = this._selected;
        this._contextTab = new CommandContextTab(command);
        this.addTab(this._contextTab);
        this.selectTab(this._contextTab);
    };

    private closeContextTab = () => {
        if (this._preSelectedTab) this.selectTab(this._preSelectedTab);
        if (this._contextTab) this.removeTab(this._contextTab);
        this._preSelectedTab = undefined;
        this._contextTab?.dispose();
        this._contextTab = undefined;
    };

    private showSelectionControl = (token: AsyncState) => {
        this._selectionControl = this.newSelectionGroup(token);
        this._selected?.add(this._selectionControl);
    };

    private clearSelectionControl = () => {
        if (this._selectionControl) {
            this._selectionControl.parentElement?.removeChild(this._selectionControl);
            this._selectionControl = undefined;
        }
    };

    private newSelectionGroup(token: AsyncState) {
        let group = new RibbonGroup("ribbon.group.selection");
        group.add(
            new RibbonButton("common.confirm", "icon-confirm", RibbonButtonSize.Normal, token.success)
        );
        group.add(new RibbonButton("common.cancel", "icon-cancel", RibbonButtonSize.Normal, token.cancel));
        return group;
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

    removeTab(tab: RibbonTab) {
        let index = this._tabs.indexOf(tab);
        if (index > 0) {
            this._tabs.splice(index, 1);
        }
        this._ribbonHeader.removeChild(tab.header);
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
