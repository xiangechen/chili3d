// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { Commands, i18n } from "chili-shared";
import { Div, Svg, TextBlock } from "../controls";
import { ModelTree } from "./tree";
import { TreeItemGroup } from "./treeItemGroup";
import style from "./treeToolBar.module.css";

export class TreeToolBar extends Div {
    constructor(readonly tree: ModelTree) {
        super(style.toolPanel);
        this.add(new TextBlock(i18n.modelTree, style.treeTitle));
        this.newIconButton("icon-folder-plus", i18n.newGroup, this.newGroup);
        this.newIconButton("icon-unexpand", i18n.unexpandAll, this.unExpandAll);
        this.newIconButton("icon-expand", i18n.expandAll, this.expandAll);
        this.newIconButton("icon-delete", i18n.delete, this.deleteModel);
    }

    private newIconButton(icon: string, tip: string, command: () => void) {
        let svg = new Svg(icon, style.treeToolIcon);
        svg.dom.addEventListener("click", command);
        let text = document.createElement("a");
        text.title = tip;
        text.appendChild(svg.dom);
        this.dom.appendChild(text);
    }

    private newGroup = () => {
        PubSub.default.pub("excuteCommand")(Commands.NewGroup);
    };

    private expandAll = () => {
        this.setExpand(true);
    };

    private unExpandAll = () => {
        this.setExpand(false);
    };

    private setExpand(expand: boolean) {
        for (let model of this.tree.treeItems()) {
            if (model instanceof TreeItemGroup) {
                model.setExpander(expand);
            }
        }
    }

    private deleteModel = () => {
        PubSub.default.pub("excuteCommand")(Commands.Delete);
    };
}
