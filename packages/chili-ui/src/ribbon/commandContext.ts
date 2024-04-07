// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding, Command, I18nKeys, ICommand, Observable, Property } from "chili-core";
import { button, div, input, label, localize, svg } from "../controls";
import style from "./commandContext.module.css";

export class CommandContext extends HTMLElement {
    private readonly propMap: Map<string | number | symbol, [Property, HTMLElement]> = new Map();

    constructor(readonly command: ICommand) {
        super();
        this.className = style.panel;
        let data = Command.getData(command);
        this.append(
            svg({ className: style.icon, icon: data!.icon }),
            label({ className: style.title, textContent: localize(data!.display) }, `: `),
        );
        this.initContext();
    }

    connectedCallback(): void {
        if (this.command instanceof Observable) {
            this.command.onPropertyChanged(this.onPropertyChanged);
        }
    }

    disconnectedCallback(): void {
        if (this.command instanceof Observable) {
            this.command.removePropertyChanged(this.onPropertyChanged);
        }
    }

    private onPropertyChanged = (property: string | number | symbol) => {
        if (this.propMap.has(property)) {
            const [prop, control] = this.propMap.get(property)!;
            this.setVisible(control, prop);
        }
    };

    private initContext() {
        let groupMap: Map<I18nKeys, HTMLDivElement> = new Map();
        for (const g of Property.getProperties(this.command)) {
            let group = this.findGroup(groupMap, g);
            let item = this.createItem(this.command, g);
            this.setVisible(item, g);
            this.cacheDependencies(item, g);
            group.append(item);
        }
    }

    private cacheDependencies(item: HTMLElement, g: Property) {
        if (g.dependencies) {
            for (const d of g.dependencies) {
                this.propMap.set(d.property, [g, item]);
            }
        }
    }

    private setVisible(control: HTMLElement, property: Property) {
        let visible = true;
        if (property.dependencies) {
            for (const d of property.dependencies) {
                if ((this.command as any)[d.property] !== d.value) {
                    visible = false;
                    break;
                }
            }
        }
        control.style.display = visible ? "" : "none";
    }

    private createItem(command: ICommand, g: Property) {
        let noType = command as any;
        let type = typeof noType[g.name];
        if (type === "function") {
            return button({
                className: style.button,
                textContent: localize(g.display),
                onclick: () => noType[g.name](),
            });
        } else if (type === "boolean") {
            return div(
                label({ textContent: localize(g.display) }),
                input({
                    type: "checkbox",
                    checked: new Binding(noType, g.name),
                    onclick: () => {
                        noType[g.name] = !noType[g.name];
                    },
                }),
            );
        } else if (type === "number") {
            return div(
                label({ textContent: localize(g.display) }),
                input({
                    type: "text",
                    className: style.input,
                    value: new Binding(noType, g.name),
                    onkeydown: (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                            let input = e.target as HTMLInputElement;
                            noType[g.name] = parseFloat(input.value);
                            input.blur();
                        }
                    },
                }),
            );
        } else {
            throw new Error("暂不支持的类型");
        }
    }

    private findGroup(groupMap: Map<I18nKeys, HTMLDivElement>, prop: Property) {
        let group = groupMap.get(prop.group!);
        if (group === undefined) {
            group = div({ className: style.group });
            groupMap.set(prop.group!, group);
            this.append(group);
        }
        return group;
    }
}

customElements.define("command-context", CommandContext);
