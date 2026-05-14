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
    type PushButton,
    type SplitButton,
} from "@chili3d/core";
import { createIcon, div, label } from "@chili3d/element";
import buttonStyle from "./ribbonButton.module.css";
import style from "./ribbonSplitButton.module.css";

function getItemData(item: PushButton | CommandKeys) {
    if (typeof item === "string") {
        const data = CommandStore.getComandData(item);
        return {
            command: item,
            icon: data?.icon ?? ("icon-command" as CommandIcon),
            display: (data ? `command.${data.key}` : item) as I18nKeys,
            onClick: () => PubSub.default.pub("executeCommand", item),
        };
    }
    return {
        command: item.command,
        icon: item.icon as CommandIcon,
        display: item.display ?? (`command.${item.command}` as I18nKeys),
        onClick: item.onClick,
    };
}

function createDropdownItem(item: PushButton | CommandKeys, onSelect: () => void): HTMLElement {
    const data = getItemData(item);
    const icon = data.icon ? createIcon(data.icon) : div();
    icon.classList.add(style.dropdownIcon);
    return div(
        {
            className: style.dropdownItem,
            onclick: (e) => {
                e.stopPropagation();
                PubSub.default.pub("executeCommand", data?.command);
                onSelect();
            },
        },
        icon,
        label({
            className: style.dropdownText,
            textContent: new Localize(data ? `command.${data.command}` : (item as I18nKeys)),
        }),
    );
}

export class RibbonSplitButton extends HTMLElement {
    #primaryIndex = 0;
    #dropdown?: HTMLElement;
    #isOpen = false;
    #iconEl?: Element;
    #textEl?: Element;

    constructor(
        readonly data: SplitButton,
        readonly size: ButtonSize,
    ) {
        super();
        this.initHTML();
    }

    dispose(): void {
        this.closeDropdown();
    }

    private initHTML() {
        if (this.data.items.length === 0) return;

        const isLarge = this.size === "large";
        this.className = isLarge ? style.split : style.splitSmall;

        const { icon: iconName, display } = getItemData(this.data.items[0]);

        this.#iconEl = createIcon(iconName);
        this.#iconEl.classList.add(isLarge ? buttonStyle.icon : buttonStyle.smallIcon);

        this.#textEl = label({
            className: isLarge ? style.text : style.smallText,
            textContent: new Localize(display),
        });

        this.append(
            div(
                {
                    className: isLarge ? style.mainArea : style.smallMainArea,
                    onclick: (e) => {
                        e.stopPropagation();
                        this.executePrimary();
                    },
                },
                this.#iconEl,
                this.#textEl,
            ),
            div(
                {
                    className: isLarge ? style.arrowButton : style.smallArrowButton,
                    onclick: (e) => {
                        e.stopPropagation();
                        if (this.#isOpen) {
                            this.closeDropdown();
                        } else {
                            this.openDropdown();
                        }
                    },
                },
                div({ className: isLarge ? style.arrow : style.smallArrow }),
            ),
        );
    }

    private executePrimary() {
        const item = this.data.items[this.#primaryIndex];
        if (!item) return;
        getItemData(item).onClick();
    }

    private openDropdown() {
        if (this.#isOpen || this.data.items.length === 0) return;

        this.#dropdown = div(
            { className: style.dropdown },
            ...this.data.items.map((item, i) =>
                createDropdownItem(item, () => {
                    this.switchPrimary(i);
                    this.closeDropdown();
                }),
            ),
        );

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

    private switchPrimary(index: number) {
        if (index === this.#primaryIndex) return;
        this.#primaryIndex = index;

        const item = this.data.items[index];
        if (!item) return;

        const { icon: iconName, display } = getItemData(item);

        if (this.#iconEl) {
            const newIcon = createIcon(iconName);
            newIcon.classList.add(this.size === "large" ? buttonStyle.icon : buttonStyle.smallIcon);
            this.#iconEl.replaceWith(newIcon);
            this.#iconEl = newIcon;
        }

        if (this.#textEl) {
            const newText = label({
                className: this.size === "large" ? style.text : style.smallText,
                textContent: new Localize(display),
            });
            this.#textEl.replaceWith(newText);
            this.#textEl = newText;
        }
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

customElements.define("ribbon-split-button", RibbonSplitButton);
