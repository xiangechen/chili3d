// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, Commands, ICommand, Logger, PubSub } from "chili-core";
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
import { div, label, localize } from "../controls";
import { CommandContext } from "./commandContext";

export class Ribbon extends Control {
    readonly titlebar: TitleBar = new TitleBar();
    private readonly _tabs: Array<RibbonTab> = [];
    private readonly _ribbonPanel: Panel;
    private readonly _ribbonHeader: Panel;
    private readonly startup: HTMLLabelElement;
    private _selected?: RibbonTab;
    private _selectionControl?: RibbonGroup;
    private _contextContainer: HTMLDivElement;
    private _contextTab?: Control;

    constructor() {
        super(style.root);
        this.startup = label({
            className: style.startup,
            textContent: localize("ribbon.tab.file"),
            onclick: () => PubSub.default.pub("showHome"),
        });
        this._contextContainer = div({ className: style.context });
        this._ribbonHeader = new Panel().addClass(style.headerPanel).addItem(this.startup);
        this._ribbonPanel = new Panel().addClass(style.contentPanel);
        this.append(this.titlebar, this._ribbonHeader, this._ribbonPanel, this._contextContainer);

        this.initRibbon(DefaultRibbon);
        this.initQuickBar(["app.doc.save", "doc.cmd.undo", "doc.cmd.redo"]);

        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
    }

    override dispose(): void {
        super.dispose();
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
    }

    private openContext = (command: ICommand) => {
        this._contextTab = new CommandContext(command);
        this._contextContainer.append(this._contextTab);
    };

    private closeContext = () => {
        if (this._contextTab) {
            this._contextContainer.removeChild(this._contextTab);
            this._contextTab?.dispose();
            this._contextTab = undefined;
        }
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

    private initQuickBar(buttons: Commands[]) {
        this.titlebar.quickToolBar.addButton(...buttons);
    }
}

customElements.define("chili-ribbon", Ribbon);
