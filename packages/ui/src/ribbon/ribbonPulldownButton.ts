// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type ButtonSize,
    type CommandIcon,
    type CommandKeys,
    CommandStore,
    type I18nKeys,
    Localize,
    PubSub,
    type PulldownButton,
    type PushButton,
} from "@chili3d/core";
import { createIcon, div, label } from "@chili3d/element";
import buttonStyle from "./ribbonButton.module.css";
import style from "./ribbonPulldownButton.module.css";

function createDropdownItem(item: PushButton | CommandKeys, onClose: () => void): HTMLElement {
    const data =
        typeof item === "string"
            ? {
                  command: item,
                  icon: CommandStore.getComandData(item)?.icon,
              }
            : item;

    const icon = data.icon ? createIcon(data.icon) : div();
    icon.classList.add(style.dropdownIcon);
    return div(
        {
            className: style.dropdownItem,
            onclick: (e) => {
                e.stopPropagation();
                PubSub.default.pub("executeCommand", data.command);
                onClose();
            },
        },
        icon,
        label({
            className: style.dropdownText,
            textContent: new Localize(data ? `command.${data.command}` : (item as I18nKeys)),
        }),
    );
}

export class RibbonPulldownButton extends HTMLElement {
    #dropdown?: HTMLElement;
    #isOpen = false;

    constructor(
        readonly data: PulldownButton,
        readonly size: ButtonSize,
    ) {
        super();
        this.initHTML();
        this.addEventListener("click", this.toggleDropdown);
    }

    dispose(): void {
        this.closeDropdown();
        this.removeEventListener("click", this.toggleDropdown);
    }

    private initHTML() {
        const icon = createIcon(this.data.icon as CommandIcon);
        this.className = this.size === "large" ? style.pulldown : style.pulldownSmall;
        icon.classList.add(this.size === "large" ? buttonStyle.icon : buttonStyle.smallIcon);

        this.append(
            icon,
            label({
                className: this.size === "large" ? style.text : style.smallText,
                textContent: new Localize(this.data.display),
            }),
            div({ className: this.size === "large" ? style.arrow : style.smallArrow }),
        );
    }

    private readonly toggleDropdown = (e: Event) => {
        e.stopPropagation();
        if (this.#isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    };

    private openDropdown() {
        if (this.#isOpen || this.data.items.length === 0) return;

        this.#dropdown = div({ className: style.dropdown });
        for (const item of this.data.items) {
            this.#dropdown.append(createDropdownItem(item, () => this.closeDropdown()));
        }

        document.body.appendChild(this.#dropdown);
        this.positionDropdown();
        this.#isOpen = true;

        document.addEventListener("click", this.onOutsideClick, true);
        document.addEventListener("keydown", this.onKeyDown);
    }

    private closeDropdown() {
        if (!this.#isOpen) return;

        this.#dropdown?.remove();
        this.#dropdown = undefined;
        this.#isOpen = false;

        document.removeEventListener("click", this.onOutsideClick, true);
        document.removeEventListener("keydown", this.onKeyDown);
    }

    private positionDropdown() {
        if (!this.#dropdown) return;
        const rect = this.getBoundingClientRect();
        this.#dropdown.style.top = `${rect.bottom + 2}px`;
        this.#dropdown.style.left = `${rect.left}px`;
    }

    private readonly onOutsideClick = (e: Event) => {
        if (this.#dropdown && !this.#dropdown.contains(e.target as Node)) {
            this.closeDropdown();
        }
    };

    private readonly onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            this.closeDropdown();
        }
    };
}

customElements.define("ribbon-pulldown-button", RibbonPulldownButton);
