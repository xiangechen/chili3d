// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants } from "chili-core";
import { Control, Panel } from "../components";

import { PropertyView } from "../property";
import { Tab } from "../tab";
import { TreeToolBar } from "../tree/treeToolBar";
import style from "./sidebar.module.css";

export class Sidebar extends Control {
    constructor() {
        super(style.sidebar);
        let tree = new Tab("items.header").addClass(style.top);
        tree.addTools(...new TreeToolBar().tools);
        tree.itemsPanel.id = Constants.TreeContainerId;

        let p = new Tab("properties.header").addClass(style.bottom).addItem(new PropertyView());
        p.itemsPanel.id = Constants.PropertiesContainerId;
        this.append(tree, p);
    }
}

customElements.define("chili-sidebar", Sidebar);
