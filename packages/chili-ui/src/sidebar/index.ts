// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants } from "chili-core";
import { Control, Panel } from "../components";

import { PropertyView } from "../property";
import { Tab } from "../tab";
import { TreeToolBar } from "../tree/treeToolBar";
import style from "./sidebar.module.css";

export class Sidebar extends Control {
    readonly tree: HTMLElement;
    readonly property: HTMLElement;

    constructor() {
        super(style.sidebar);
        let tab = new Tab("items.header");
        tab.addTools(...new TreeToolBar().tools);
        tab.itemsPanel.id = Constants.TreeContainerId;

        this.tree = new Panel().addClass(style.top).addItem(tab);
        this.property = new Panel().addClass(style.bottom).addItem(new PropertyView());
        this.append(this.tree, this.property);
    }
}

customElements.define("chili-sidebar", Sidebar);
