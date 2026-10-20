// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Binding,
    type ButtonSize,
    type IConverter,
    Localize,
    ObservableCollection,
    Result,
    type RibbonButton,
    type RibbonCommand,
    type RibbonGroup,
} from "@chili3d/core";
import { collection, div, label } from "@chili3d/element";
import { createDropdownItem, DropdownController } from "./dropdownController";
import { RibbonPushButton } from "./ribbonButton";
import style from "./ribbonGroup.module.css";
import { RibbonPulldownButton } from "./ribbonPulldownButton";
import { RibbonSplitButton } from "./ribbonSplitButton";
import { RibbonStack } from "./ribbonStack";

export function createRibbonButton(item: RibbonCommand): HTMLElement | undefined {
    if (item instanceof ObservableCollection) {
        return createRibbonStack(item);
    }
    return createRibbonButtonElement(item, "large");
}

function createRibbonStack(items: ObservableCollection<RibbonButton>): RibbonStack | undefined {
    const stack = new RibbonStack();
    items.forEach((item) => {
        const button = createRibbonButtonElement(item, "small");
        if (button) stack.append(button);
    });
    return stack.childElementCount > 0 ? stack : undefined;
}

function createRibbonButtonElement(item: RibbonButton, size: ButtonSize): HTMLElement | undefined {
    if (typeof item === "string") {
        return RibbonPushButton.fromCommandName(item, size);
    } else if (item.type === "push") {
        return new RibbonPushButton(item.command, item.icon, size, item.onClick, item.display);
    } else if (item.type === "pulldown") {
        return new RibbonPulldownButton(item, size);
    } else if (item.type === "split") {
        return new RibbonSplitButton(item, size);
    } else {
        throw new Error("unknown ribbon button type");
    }
}

class DisplayConverter implements IConverter<number> {
    constructor(readonly predicate: (value: number) => boolean) {}

    convert(value: number): Result<string> {
        return Result.ok(this.predicate(value) ? "" : "none");
    }
}

export class RibbonGroupElement extends HTMLElement {
    #dropdown = new DropdownController(style.collapsedDropdown);

    constructor(readonly group: RibbonGroup) {
        super();
        this.className = style.ribbonGroup;
        this.initHTML();
    }

    dispose(): void {
        this.#dropdown.dispose();
    }

    private initHTML() {
        this.append(
            collection({
                className: style.content,
                sources: this.group.items,
                template: (item) => createRibbonButton(item),
            }),
            div(
                { className: style.headerContainer },
                label({ className: style.header, textContent: new Localize(this.group.groupName) }),
                div({
                    className: style.arrow,
                    style: {
                        display: new Binding(
                            this.group.collapsedItems,
                            "length",
                            new DisplayConverter((l: number) => l > 0),
                        ),
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                        if (this.#dropdown.isOpened) {
                            this.#dropdown.close();
                        } else {
                            this.openDropdown((e.currentTarget as HTMLElement).parentElement as HTMLElement);
                        }
                    },
                }),
            ),
        );
    }

    private openDropdown(anchorEl: HTMLElement) {
        if (this.#dropdown.isOpened || this.group.collapsedItems.length === 0) return;

        this.#dropdown.open(anchorEl, (dropdown) => {
            for (const cmdKey of this.group.collapsedItems) {
                dropdown.append(
                    createDropdownItem(cmdKey, () => this.#dropdown.close(), {
                        item: style.collapsedDropdownItem,
                        icon: style.collapsedDropdownIcon,
                        text: style.collapsedDropdownText,
                    }),
                );
            }
        });
    }
}

customElements.define("ribbon-group", RibbonGroupElement);
