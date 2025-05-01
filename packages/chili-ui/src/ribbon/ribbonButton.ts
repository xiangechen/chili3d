// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { label, svg } from "chili-controls";
import {
    ButtonSize,
    Command,
    CommandData,
    CommandKeys,
    I18n,
    I18nKeys,
    IConverter,
    Localize,
    Logger,
    PubSub,
    Result,
} from "chili-core";
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
        const data = Command.getData(commandName);
        if (!data) {
            Logger.warn(`commandData of ${commandName} is undefined`);
            return undefined;
        }
        if (data.toggle) {
            return new RibbonToggleButton(data, size);
        }
        return new RibbonButton(`command.${data.key}`, data.icon, size, () => {
            PubSub.default.pub("executeCommand", commandName);
        });
    }

    dispose(): void {
        this.removeEventListener("click", this.onClick);
    }

    private initHTML(display: I18nKeys, icon: string, size: ButtonSize) {
        const image = svg({ icon });
        this.className = size === ButtonSize.large ? style.normal : style.small;
        image.classList.add(size === ButtonSize.large ? style.icon : style.smallIcon);
        const text = label({
            className: style.buttonText,
            textContent: new Localize(display),
        });
        I18n.set(this, "title", display);
        this.append(image, text);
    }
}

customElements.define("ribbon-button", RibbonButton);

class ToggleConverter implements IConverter {
    constructor(
        readonly className: string,
        readonly active: string,
    ) {}
    convert(isChecked: boolean): Result<string, string> {
        return isChecked ? Result.ok(`${this.className} ${this.active}`) : Result.ok(this.className);
    }
}

export class RibbonToggleButton extends RibbonButton {
    constructor(data: CommandData, size: ButtonSize) {
        super(`command.${data.key}`, data.icon, size, () => {
            PubSub.default.pub("executeCommand", data.key);
        });

        if (data.toggle) {
            data.toggle.converter = new ToggleConverter(this.className, style.checked);
            data.toggle.setBinding(this, "className");
        }
    }
}

customElements.define("ribbon-toggle-button", RibbonToggleButton);
