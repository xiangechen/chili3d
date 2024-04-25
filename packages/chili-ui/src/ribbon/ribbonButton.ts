// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ButtonSize, Command, CommandKeys, I18nKeys, Logger, PubSub } from "chili-core";
import { label, localize, svg } from "../components";
import style from "./ribbonButton.module.css";

export class RibbonButton extends HTMLElement {
    constructor(
        display: I18nKeys,
        icon: string,
        size: ButtonSize,
        readonly onClick: () => void,
    ) {
        super();
        this.initHTML(display, icon, size);
        this.addEventListener("click", onClick);
    }

    static fromCommandName(commandName: CommandKeys, size: ButtonSize) {
        let data = Command.getData(commandName);
        if (data === undefined) {
            Logger.warn(`commandData of ${commandName} is undefined`);
            return undefined;
        }
        return new RibbonButton(data.display, data.icon, size, () => {
            PubSub.default.pub("executeCommand", commandName);
        });
    }

    dispose(): void {
        this.removeEventListener("click", this.onClick);
    }

    private initHTML(display: I18nKeys, icon: string, size: ButtonSize) {
        let image = svg({
            icon,
        });
        if (size === ButtonSize.large) {
            image.classList.add(style.icon);
            this.className = style.normal;
        } else {
            image.classList.add(style.smallIcon);
            this.className = style.small;
        }
        let text = label({
            className: style.buttonText,
            textContent: localize(display),
        });
        this.append(image, text);
    }
}

customElements.define("ribbon-button", RibbonButton);
