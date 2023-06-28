// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, Commands, I18n, Logger, PubSub } from "chili-core";
import { Control, Label, Svg } from "../components";
import style from "./ribbonButton.module.css";
import { RibbonButtonSize } from "./ribbonButtonSize";

export class RibbonButton extends Control {
    constructor(display: keyof I18n, icon: string, size: RibbonButtonSize, readonly onClick: () => void) {
        super();
        this.initHTML(display, icon, size);
        this.addEventListener("click", onClick);
    }

    static fromCommandName(commandName: keyof Commands, size: RibbonButtonSize) {
        let data = CommandData.get(commandName);
        if (data === undefined) {
            Logger.warn(`commandData of ${commandName} is undefined`);
            return undefined;
        }
        return new RibbonButton(data.display, data.icon, size, () => {
            PubSub.default.pub("excuteCommand", commandName);
        });
    }

    override dispose(): void {
        super.dispose();
        this.removeEventListener("click", this.onClick);
    }

    private initHTML(display: keyof I18n, icon: string, size: RibbonButtonSize) {
        let image = new Svg(icon);
        if (size === RibbonButtonSize.Normal) {
            image.addClass(style.icon);
            this.className = style.normal;
        } else {
            image.addClass(style.smallIcon);
            this.className = style.small;
        }
        let text = new Label().i18nText(display).addClass(style.buttonText);
        this.append(image, text);
    }
}

customElements.define("ribbon-button", RibbonButton);
