// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, I18nKeys, INode, PubSub } from "chili-core";
import { a, svg } from "../components";
import { ProjectView } from "./projectView";
import style from "./toolBar.module.css";
import { Tree } from "./tree";
import { TreeGroup } from "./tree/treeItemGroup";

export class ToolBar extends HTMLElement {
    constructor(readonly projectView: ProjectView) {
        super();
        this.className = style.panel;
        this.newIconButton("icon-folder-plus", "items.tool.newFolder", this.newGroup);
        this.newIconButton("icon-unexpand", "items.tool.unexpandAll", this.unExpandAll);
        this.newIconButton("icon-expand", "items.tool.expandAll", this.expandAll);
    }

    private newIconButton(icon: string, tip: I18nKeys, command: () => void) {
        this.append(
            a(
                { title: I18n.translate(tip) },
                svg({
                    icon,
                    className: style.svg,
                    onclick: command,
                }),
            ),
        );
    }

    private newGroup = () => {
        PubSub.default.pub("executeCommand", "create.folder");
    };

    private expandAll = () => {
        this.setExpand(true);
    };

    private unExpandAll = () => {
        this.setExpand(false);
    };

    private setExpand(expand: boolean) {
        let tree = this.projectView.activeTree();
        if (!tree) return;
        let first = this.projectView.activeDocument?.rootNode.firstChild;
        if (first) this.setNodeExpand(tree, first, expand);
    }

    private setNodeExpand(tree: Tree, list: INode, expand: boolean) {
        let item = tree.treeItem(list);
        if (item instanceof TreeGroup) {
            item.isExpanded = expand;
        }
        if (INode.isLinkedListNode(list) && list.firstChild) {
            this.setNodeExpand(tree, list.firstChild, expand);
        }
        if (list.nextSibling) {
            this.setNodeExpand(tree, list.nextSibling, expand);
        }
    }
}

customElements.define("chili-toolbar", ToolBar);
