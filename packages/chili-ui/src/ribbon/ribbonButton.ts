// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { label, svg } from "chili-controls";
import {
    ButtonSize,
    type CommandData,
    type CommandKeys,
    CommandUtils,
    Config,
    I18n,
    type I18nKeys,
    type IConverter,
    Localize,
    Logger,
    PubSub,
    Result,
    ShortcutProfiles,
} from "chili-core";
import style from "./ribbonButton.module.css";

export class RibbonButton extends HTMLElement {
    #shortcut?: string;
    get shortcut() {
        return this.#shortcut;
    }

    constructor(
        readonly commandName: CommandKeys,
        icon: string,
        size: ButtonSize,
        readonly onClick: () => void,
        display?: I18nKeys,
    ) {
        super();
        this.initHTML(display ?? `command.${commandName}`, icon, size);
        this.addEventListener("click", onClick);
    }

    static fromCommandName(commandName: CommandKeys, size: ButtonSize) {
        const data = CommandUtils.getComandData(commandName);
        if (!data) {
            Logger.warn(`commandData of ${commandName} is undefined`);
            return undefined;
        }
        if (data.toggle) {
            return new RibbonToggleButton(data, size);
        }

        return new RibbonButton(data.key, data.icon, size, () => {
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
            className: size === ButtonSize.large ? style.largeButtonText : style.smallButtonText,
            textContent: new Localize(display),
        });

        I18n.set(this, "title", display);
        this.updateShortcut();

        this.append(image, text);
    }

    updateShortcut() {
        const shortcutData = ShortcutProfiles[Config.instance.navigation3D][this.commandName];
        const shortcut = Array.isArray(shortcutData) ? shortcutData.join("; ") : shortcutData;

        if (shortcut) {
            if (this.#shortcut) {
                this.title = this.title.replace(this.#shortcut, shortcut);
            } else {
                this.title += ` (${shortcut})`;
            }
            this.#shortcut = shortcut;
        } else if (this.#shortcut) {
            this.title = this.title.replace(this.#shortcut, "");
            this.#shortcut = undefined;
        }
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
        super(data.key, data.icon, size, () => {
            PubSub.default.pub("executeCommand", data.key);
        });

        if (data.toggle) {
            data.toggle.converter = new ToggleConverter(this.className, style.checked);
            data.toggle.setBinding(this, "className");
        }
    }
}

customElements.define("ribbon-toggle-button", RibbonToggleButton);
