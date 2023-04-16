// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Commands, I18n, i18n, PubSub } from "chili-core";
import { Svg } from "../components";

import style from "./treeToolBar.module.css";

export class TreeToolBar {
    readonly tools: HTMLElement[] = [];
    constructor() {
        this.newIconButton("icon-folder-plus", "items.tool.newFolder", this.newGroup);
        this.newIconButton("icon-unexpand", "items.tool.unexpandAll", this.unExpandAll);
        this.newIconButton("icon-expand", "items.tool.expandAll", this.expandAll);
        this.newIconButton("icon-delete", "items.tool.delete", this.deleteModel);
    }

    private newIconButton(icon: string, tip: keyof I18n, command: () => void) {
        let svg = new Svg(icon).addClass(style.treeToolIcon);
        svg.addEventListener("click", command);
        let text = document.createElement("a");
        text.title = i18n[tip];
        text.append(svg);

        this.tools.push(text);
    }

    private newGroup = () => {
        PubSub.default.pub("excuteCommand", "NewFolder");
    };

    private expandAll = () => {
        this.setExpand(true);
    };

    private unExpandAll = () => {
        this.setExpand(false);
    };

    private setExpand(expand: boolean) {
        console.log("todo");
    }

    private deleteModel = () => {
        PubSub.default.pub("excuteCommand", "Delete");
    };
}
