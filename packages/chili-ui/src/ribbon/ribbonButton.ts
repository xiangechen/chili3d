// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, Container, ICommand, Logger, Token } from "chili-core";
import { Control, Label, Svg } from "../components";
import { RibbonButtonSize } from "./ribbonButtonSize";
import style from "./ribbonButton.module.css";

export class RibbonButton extends Control {
    constructor(readonly commandName: string, size: RibbonButtonSize, handleCommand: (name: string) => void) {
        super();
        this.initHTML(commandName, size);
        this.addEventListener("click", () => handleCommand(commandName));
    }

    private initHTML(commandName: string, size: RibbonButtonSize) {
        let data = CommandData.get(commandName);
        if (data === undefined) {
            Logger.warn(`commandData of ${commandName} is undefined`);
        } else {
            let image = new Svg(data.icon);
            let text = new Label().i18nText(data.display).addClass(style.buttonText);
            this.append(image, text);

            if (size === RibbonButtonSize.Normal) {
                image.addClass(style.icon);
                this.className = style.normal;
            } else {
                image.addClass(style.smallIcon);
                this.className = style.small;
            }
        }
    }
}

customElements.define("ribbon-button", RibbonButton);
