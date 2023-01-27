// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, Container, ICommand, Logger, Token } from "chili-core";

import { Control } from "../control";
import style from "./ribbon.module.css";
import { RibbonButtonSize } from "./ribbonButtonSize";

export class RibbonButton {
    readonly dom: HTMLDivElement;
    constructor(readonly commandName: string, size: RibbonButtonSize, handleCommand: (name: string) => void) {
        this.dom = Control.div();
        let data = CommandData.get(commandName);
        if (data === undefined) {
            Logger.warn(`commandData of ${commandName} is undefined`);
        } else {
            let image = Control.svg(data.icon);
            let text = Control.span(data.display, style.buttonText);
            this.dom.appendChild(image);
            this.dom.appendChild(text);

            if (size === RibbonButtonSize.Normal) {
                image.classList.add(style.buttonIcon);
                this.dom.classList.add(style.buttonNormal);
            } else {
                image.classList.add(style.buttonIconMini);
                this.dom.classList.add(style.buttonMini);
            }
        }

        this.dom.addEventListener("click", () => handleCommand(commandName));
    }
}
