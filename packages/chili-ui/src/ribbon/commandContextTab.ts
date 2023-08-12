// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CommandData, I18n, ICommand, Observable, Property } from "chili-core";
import { Control } from "../components";
import { RibbonButton } from "./ribbonButton";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonGroup } from "./ribbonGroup";
import { RibbonTab } from "./ribbonTab";
import { RibbonToggleButton } from "./ribbonToggleButton";

export class CommandContextTab extends RibbonTab {
    private readonly propMap: Map<string | number | symbol, [Property, Control]> = new Map();

    constructor(readonly command: ICommand) {
        super(CommandData.get(command)!.display);
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
        let groupMap: Map<keyof I18n, RibbonGroup> = new Map();
        for (const g of Property.getProperties(this.command)) {
            if (!g.group) continue;
            let group = this.findGroup(groupMap, g, this);
            let item = this.createRibbonItem(this.command, g);
            this.setVisible(item, g);
            this.cacheDependencies(item, g);
            group.add(item);
        }
    }

    private cacheDependencies(item: RibbonButton, g: Property) {
        if (g.dependencies) {
            for (const d of g.dependencies) {
                this.propMap.set(d.property, [g, item]);
            }
        }
    }

    private setVisible(control: Control, property: Property) {
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
            return new RibbonButton(g.display, g.icon!, RibbonButtonSize.Normal, () => {
                noType[g.name]();
            });
        } else if (type === "boolean") {
            return new RibbonToggleButton(command, g, RibbonButtonSize.Normal);
        } else {
            return new RibbonButton(g.display, g.icon!, RibbonButtonSize.Normal, () => {});
        }
    }

    private findGroup(groupMap: Map<keyof I18n, RibbonGroup>, prop: Property, tab: RibbonTab) {
        let group = groupMap.get(prop.group!);
        if (group === undefined) {
            group = new RibbonGroup(prop.group!);
            groupMap.set(prop.group!, group);
            tab.add(group);
        }
        return group;
    }
}

customElements.define("context-tab", CommandContextTab);
