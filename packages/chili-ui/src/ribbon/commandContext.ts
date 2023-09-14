// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Command, I18nKeys, ICommand, Observable, Property } from "chili-core";
import { Control } from "../components";
import { bind, button, div, input, label, localize, svg } from "../controls";
import style from "./commandContext.module.css";

export class CommandContext extends Control {
    private readonly propMap: Map<string | number | symbol, [Property, HTMLElement]> = new Map();

    constructor(readonly command: ICommand) {
        super(style.panel);
        let data = Command.getData(command);
        this.append(
            svg({ className: style.icon, icon: data!.icon }),
            label({ className: style.title, textContent: localize(data!.display) }, `: `),
        );
        this.initContext();
        if (command instanceof Observable) {
            this.addConnectedCallback(() => {
                command.onPropertyChanged(this.onPropertyChanged);
            });
            this.addDisconnectedCallback(() => {
                command.removePropertyChanged(this.onPropertyChanged);
            });
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
            let item = this.createRibbonItem(this.command, g);
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

    private createRibbonItem(command: ICommand, g: Property) {
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
                    checked: bind(noType, g.name),
                    onclick: () => {
                        noType[g.name] = !noType[g.name];
                    },
                }),
            );
        } else {
            return div(
                label({ textContent: localize(g.display) }),
                // input({type: "text", value: bind(noType, g.name), onchange: () => {
                //     noType[g.name] = (noType[g.name] as any).toString();
                // }})
            );
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
