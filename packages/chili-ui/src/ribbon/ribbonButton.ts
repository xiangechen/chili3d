// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, ICommand } from "chili-core";
import { Container, Logger, Token } from "chili-shared";
import { Div, TextBlock, Svg } from "../controls";
import { RibbonButtonSize } from "./ribbonButtonSize";
import style from "./ribbon.module.css";

export class RibbonButton extends Div {
    constructor(readonly commandName: string, size: RibbonButtonSize, handleCommand: (name: string) => void) {
        super();
        let data = CommandData.get(commandName);
        if (data === undefined) {
            Logger.warn(`commandData of ${commandName} is undefined`);
        } else {
            let image = new Svg(data.icon);
            let text = new TextBlock(data.display, style.buttonText);
            this.dom.appendChild(image.dom);
            this.add(text);

            if (size === RibbonButtonSize.Normal) {
                image.addClass(style.buttonIcon);
                this.addClass(style.buttonNormal);
            } else {
                image.addClass(style.buttonIconMini);
                this.addClass(style.buttonMini);
            }
        }

        this.dom.addEventListener("click", () => handleCommand(commandName));
    }
}
