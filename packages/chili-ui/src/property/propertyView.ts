// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, I18n, IConverter, IDocument, INode, Property, PubSub } from "chili-core";
import { Control, Expander, Label, Panel } from "../components";

import { CheckProperty } from "./check";
import { InputProperty } from "./input";
import style from "./propertyView.module.css";
import { MatrixConverter, RotateConverter, ScalingConverter, TranslationConverter } from "./matrixConverter";

export class PropertyView extends Control {
    private panel = new Panel(style.panel);
    constructor() {
        super(style.root);
        this.append(new Label().i18nText("properties.header").addClass(style.header), this.panel);
        PubSub.default.sub("selectionChanged", this.selectionChanged);
    }

    private selectionChanged = (document: IDocument, selected: INode[], unselected: INode[]) => {
        this.panel.clearChildren();
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
        let transform = new Expander("properties.group.transform").addClass(style.expander);
        this.panel.append(transform);
        const addMatrix = (display: keyof I18n, converter: IConverter) => {
            this.appendProperty(transform, document, nodes, {
                name: "matrix",
                display,
                converter,
            });
        };
        // 这部分代码有问题，待完善
        let converters = MatrixConverter.init();
        addMatrix("model.translation", converters.translation);
        addMatrix("model.scale", converters.scale);
        addMatrix("model.rotation", converters.rotate);
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
