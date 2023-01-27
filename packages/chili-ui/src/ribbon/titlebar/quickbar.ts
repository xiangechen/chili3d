// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, Container, ICommand, Logger, Token } from "chili-core";

import { Control } from "../../control";
import style from "./quickbar.module.css";

export interface QuickbarButton {
    icon: string;
    text: string;
    command: string;
}

export class QuickToolbar {
    constructor(readonly container: HTMLDivElement) {
        container.classList.add(style.quickbarPanel);
    }

    addButton(commandName: string, handleCommand: (name: string) => void) {
        let data = CommandData.get(commandName);
        if (data === undefined) {
            Logger.warn("commandData is undefined");
            return;
        }
        let s = Control.svg(data.icon);
        s.classList.add(style.quickbarIcon, `${data.icon}`);
        s.addEventListener("click", () => handleCommand(commandName));
        this.container.appendChild(s);
    }

    fromConfig(configs: string[], handleCommand: (name: string) => void) {
        configs.forEach((x) => {
            this.addButton(x, handleCommand);
        });
    }
}
