// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { Commands, I18n, i18n } from "chili-core";
import { Control } from "../control";
import { ModelTree } from "./tree";
import { TreeItemGroup } from "./treeItemGroup";
import style from "./treeToolBar.module.css";

export class TreeToolBar {
    readonly tools: HTMLElement[] = [];
    constructor(readonly tree: ModelTree) {
        this.newIconButton("icon-folder-plus", "items.tool.newFolder", this.newGroup);
        this.newIconButton("icon-unexpand", "items.tool.unexpandAll", this.unExpandAll);
        this.newIconButton("icon-expand", "items.tool.expandAll", this.expandAll);
        this.newIconButton("icon-delete", "items.tool.delete", this.deleteModel);
    }

    private newIconButton(icon: string, tip: keyof I18n, command: () => void) {
        let svg = Control.svg(icon, style.treeToolIcon);
        svg.addEventListener("click", command);
        let text = document.createElement("a");
        text.title = i18n[tip];
        text.appendChild(svg);
        this.tools.push(text);
    }

    private newGroup = () => {
        PubSub.default.pub("excuteCommand", "NewGroup");
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
        PubSub.default.pub("excuteCommand", "Delete");
    };
}
