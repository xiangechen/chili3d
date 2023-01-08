// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "chili-core";
import { Commands, I18n, i18n } from "chili-shared";
import { Control } from "../control";
import { ModelTree } from "./tree";
import { TreeItemGroup } from "./treeItemGroup";
import style from "./treeToolBar.module.css";

export class TreeToolBar {
    readonly dom: HTMLDivElement;
    constructor(readonly tree: ModelTree) {
        this.dom = Control.div(style.toolPanel);
        this.dom.appendChild(Control.span("ui.tree.header", style.treeTitle));
        this.newIconButton("icon-folder-plus", "ui.tree.tool.newGroup", this.newGroup);
        this.newIconButton("icon-unexpand", "ui.tree.tool.unexpandAll", this.unExpandAll);
        this.newIconButton("icon-expand", "ui.tree.tool.expandAll", this.expandAll);
        this.newIconButton("icon-delete", "ui.tree.tool.delete", this.deleteModel);
    }

    private newIconButton(icon: string, tip: keyof I18n, command: () => void) {
        let svg = Control.svg(icon, style.treeToolIcon);
        svg.addEventListener("click", command);
        let text = document.createElement("a");
        text.title = i18n[tip];
        text.appendChild(svg);
        this.dom.appendChild(text);
    }

    private newGroup = () => {
        PubSub.default.pub("excuteCommand", Commands.NewGroup);
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
        PubSub.default.pub("excuteCommand", Commands.Delete);
    };
}
