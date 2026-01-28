// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { label, svg } from "chili-controls";
import {
    ButtonSize,
    type CommandData,
    type CommandKeys,
    CommandUtils,
    DefaultShortcuts,
    I18n,
    type I18nKeys,
    type IConverter,
    Localize,
    Logger,
    PubSub,
    Result,
} from "chili-core";
import style from "./ribbonButton.module.css";

export class RibbonButton extends HTMLElement {
    private observer?: MutationObserver;

    constructor(
        display: I18nKeys,
        icon: string,
        size: ButtonSize,
        readonly onClick: () => void,
        shortcut?: string,
    ) {
        super();
        this.initHTML(display, icon, size, shortcut);
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

        const shortcutData = DefaultShortcuts[commandName];
        const shortcut = Array.isArray(shortcutData) ? shortcutData[0] : shortcutData;

        return new RibbonButton(
            `command.${data.key}`,
            data.icon,
            size,
            () => {
                PubSub.default.pub("executeCommand", commandName);
            },
            shortcut,
        );
    }

    dispose(): void {
        this.removeEventListener("click", this.onClick);
        this.observer?.disconnect();
    }

    private initHTML(display: I18nKeys, icon: string, size: ButtonSize, shortcut?: string) {
        const image = svg({ icon });
        this.className = size === ButtonSize.large ? style.normal : style.small;
        image.classList.add(size === ButtonSize.large ? style.icon : style.smallIcon);
        const text = label({
            className: size === ButtonSize.large ? style.largeButtonText : style.smallButtonText,
            textContent: new Localize(display),
        });

        I18n.set(this, "title", display);

        if (shortcut) {
            const updateTitle = () => {
                const current = this.getAttribute("title");
                if (current && !current.includes(`(${shortcut})`)) {
                    this.setAttribute("title", `${current} (${shortcut})`);
                }
            };
            updateTitle();
            this.observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === "attributes" && m.attributeName === "title") {
                        updateTitle();
                    }
                }
            });
            this.observer.observe(this, { attributes: true });
        }

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
