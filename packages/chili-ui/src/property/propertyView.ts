// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, GeometryModel, IModel, Property, PubSub, INode } from "chili-core";
import { Control, Panel, Expander, Label } from "../components";

import { CheckProperty } from "./check";
import { InputProperty } from "./input";
import style from "./propertyView.module.css";

export class PropertyView extends Control {
    private panel = new Panel(style.panel);
    constructor() {
        super(style.root);
        this.append(new Label().i18nText("properties.header").addClass(style.header), this.panel);
        PubSub.default.sub("selectionChanged", this.selectionChanged);
    }

    private selectionChanged = (document: IDocument, selected: INode[], unselected: INode[]) => {
        this.clearChildren(this.panel);
        if (selected.length === 0) return;
        this.addDefault(document, selected);
        this.addTransform(document, selected);
        this.addBody(selected, document);
    };

    private addDefault(document: IDocument, nodes: INode[]) {
        this.appendProperty(this.panel, document, nodes, Property.get(nodes.at(0), "name"));
    }

    private addBody(nodes: INode[], document: IDocument) {
        nodes = nodes.filter((x) => INode.isModelNode(x));
        if (nodes.length === 0) return;
        if (!nodes.some((x) => INode.isModelGroup(x))) {
            let bodies = nodes.map((x) => (x as GeometryModel).body);
            let body = new Expander(bodies[0].name);
            this.panel.append(body);
            body.classList.add(style.expander);
            Property.getAll(bodies[0]).forEach((x) => {
                this.appendProperty(body.contenxtPanel, document, bodies, x);
            });
        }
    }

    private addTransform(document: IDocument, nodes: INode[]) {
        nodes = nodes.filter((x) => INode.isModelNode(x));
        if (nodes.length === 0) return;
        let transform = new Expander("properties.group.transform");
        transform.addClass(style.expander);
        this.panel.append(transform);
        this.appendProperty(transform, document, nodes, Property.get(nodes.at(0), "model.translation"));
        this.appendProperty(transform, document, nodes, Property.get(nodes.at(0), "model.rotation"));
        this.appendProperty(transform, document, nodes, Property.get(nodes.at(0), "model.scale"));
    }

    private appendProperty(container: HTMLElement, document: IDocument, objs: any[], prop?: Property) {
        if (prop === undefined) return;
        const type = typeof (objs[0] as unknown as any)[prop.name];
        if (type === "object" || type === "string" || type === "number") {
            container.append(new InputProperty(document, objs, prop));
        } else if (type === "boolean") {
            container.append(new CheckProperty(objs, prop));
        }
    }
}

customElements.define("chili-property-view", PropertyView);
