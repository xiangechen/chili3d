// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, CommandData, Config, I18n, ICommand, Logger, Property, PubSub } from "chili-core";
import { Control, Label, Panel } from "../components";
import { DefaultRibbon } from "../profile/ribbon";
import { RibbonData } from "./ribbonData";
import { RibbonTab } from "./ribbonTab";
import { TitleBar } from "./titlebar";

import style from "./ribbon.module.css";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonGroup } from "./ribbonGroup";
import { RibbonToggleButton } from "./ribbonToggleButton";

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
        this._contextTab = this.initContextTab(command);
        this.addTab(this._contextTab);
        this.selectTab(this._contextTab);
    };

    private closeContextTab = () => {
        if (this._preSelectedTab) this.selectTab(this._preSelectedTab);
        if (this._contextTab) this.removeTab(this._contextTab);
        this._preSelectedTab = undefined;
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

    private initContextTab(command: ICommand) {
        let tab = new RibbonTab(CommandData.get(command)!.display);
        let groupMap: Map<keyof I18n, RibbonGroup> = new Map();
        for (const g of Property.getProperties(command)) {
            if (!g.group) continue;
            if (g.dependencies) {
                let show = true;
                for (const d of g.dependencies) {
                    if ((command as any)[d.property] !== d.value) {
                        show = false;
                        break;
                    }
                }
                if (!show) continue;
            }
            let group = this.findGroup(groupMap, g, tab);
            let item = this.createRibbonItem(command, g);
            group.add(item);
        }
        return tab;
    }

    private createRibbonItem(command: ICommand, g: Property) {
        let noType = command as any;
        let type = typeof noType[g.name];
        if (type === "function") {
            return new RibbonButton(g.display, g.icon!, RibbonButtonSize.Normal, () => {
                noType[g.name]();
            });
        } else if (type === "boolean") {
            return new RibbonToggleButton(command, g, RibbonButtonSize.Normal);
        } else {
            return new RibbonButton(g.display, g.icon!, RibbonButtonSize.Normal, () => {});
        }
    }

    private findGroup(groupMap: Map<keyof I18n, RibbonGroup>, prop: Property, tab: RibbonTab) {
        let group = groupMap.get(prop.group!);
        if (group === undefined) {
            group = new RibbonGroup(prop.group!);
            groupMap.set(prop.group!, group);
            tab.add(group);
        }
        return group;
    }

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
