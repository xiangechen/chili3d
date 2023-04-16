// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, Logger, PubSub } from "chili-core";
import { Control, Svg } from "../../components";

import style from "./quickbar.module.css";

export class QuickToolbar extends Control {
    constructor() {
        super(style.root);
    }

    addButton(...commands: string[]) {
        let buttons: Svg[] = [];
        for (const command of commands) {
            let data = CommandData.get(command);
            if (data === undefined) {
                Logger.warn("commandData is undefined");
                continue;
            }
            let button = new Svg(data.icon)
                .addClass(style.icon)
                .onClick(() => PubSub.default.pub("excuteCommand", command as any));
            buttons.push(button);
        }

        this.append(...(buttons.filter((x) => x !== undefined) as any));
    }
}

customElements.define("chili-quickbar", QuickToolbar);
