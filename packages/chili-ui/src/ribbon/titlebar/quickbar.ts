// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, ICommand } from "chili-core";
import { Container, Token, Logger } from "chili-shared";
import { Div, Svg } from "../../controls";
import style from "./quickbar.module.css";

export interface QuickbarButton {
    icon: string;
    text: string;
    command: string;
}

export class QuickToolbar {
    constructor(readonly container: Div) {
        container.addClass(style.quickbarPanel);
    }

    addButton(commandName: string, handleCommand: (name: string) => void) {
        let data = CommandData.get(commandName);
        if (data === undefined) {
            Logger.warn("commandData is undefined");
            return;
        }
        let s = new Svg(data.icon);
        s.addClass(style.quickbarIcon, `${data.icon}`);
        s.dom.addEventListener("click", () => handleCommand(commandName));
        this.container.dom.appendChild(s.dom);
    }

    fromConfig(configs: string[], handleCommand: (name: string) => void) {
        configs.forEach((x) => {
            this.addButton(x, handleCommand);
        });
    }
}
