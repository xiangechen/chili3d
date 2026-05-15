// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandIcon,
    type CommandKeys,
    CommandStore,
    type I18nKeys,
    Localize,
    PubSub,
    type PushButton,
} from "@chili3d/core";
import { createIcon, div, label } from "@chili3d/element";

export interface DropdownItemData {
    command: CommandKeys;
    icon: CommandIcon;
    display: I18nKeys;
    onClick: () => void;
}

export function getItemData(item: PushButton | CommandKeys): DropdownItemData {
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

export interface DropdownItemClasses {
    item: string;
    icon: string;
    text: string;
}

export function createDropdownItem(
    item: PushButton | CommandKeys,
    onSelect: () => void,
    classes: DropdownItemClasses,
): HTMLElement {
    const data = getItemData(item);
    const icon = data.icon ? createIcon(data.icon) : div();
    icon.classList.add(classes.icon);
    return div(
        {
            className: classes.item,
            onclick: (e) => {
                e.stopPropagation();
                PubSub.default.pub("executeCommand", data.command);
                onSelect();
            },
        },
        icon,
        label({
            className: classes.text,
            textContent: new Localize(data.display),
        }),
    );
}

export class DropdownController {
    static readonly openedDropdowns = new Set<DropdownController>();

    static closeAll(): void {
        for (const controller of DropdownController.openedDropdowns) {
            controller.close();
        }
    }

    #dropdown?: HTMLElement;
    #isOpened = false;
    readonly #containerClass: string;

    constructor(containerClass: string) {
        this.#containerClass = containerClass;
    }

    get isOpened(): boolean {
        return this.#isOpened;
    }

    open(anchor: HTMLElement, buildItems: (dropdown: HTMLElement) => void): void {
        if (this.#isOpened) return;

        DropdownController.closeAll();
        const dropdown = div({ className: this.#containerClass });
        buildItems(dropdown);

        document.body.appendChild(dropdown);
        this.#position(dropdown, anchor);
        this.#dropdown = dropdown;
        this.#isOpened = true;
        DropdownController.openedDropdowns.add(this);

        document.addEventListener("click", this.#onOutsideClick);
        document.addEventListener("keydown", this.#onKeyDown);
    }

    close(): void {
        if (!this.#isOpened) return;

        this.#dropdown?.remove();
        this.#dropdown = undefined;
        this.#isOpened = false;
        DropdownController.openedDropdowns.delete(this);

        document.removeEventListener("click", this.#onOutsideClick);
        document.removeEventListener("keydown", this.#onKeyDown);
    }

    dispose(): void {
        this.close();
    }

    #position(dropdown: HTMLElement, anchor: HTMLElement): void {
        const rect = anchor.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 2}px`;
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.width = `${rect.width}px`;
    }

    readonly #onOutsideClick = (e: Event) => {
        if (this.#dropdown && !this.#dropdown.contains(e.target as Node)) {
            this.close();
        }
    };

    readonly #onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            this.close();
        }
    };
}
