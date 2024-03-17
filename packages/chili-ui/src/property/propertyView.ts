// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Color,
    GeometryModel,
    I18nKeys,
    IConverter,
    IDocument,
    INode,
    IView,
    Property,
    PubSub,
} from "chili-core";
import { Expander } from "../components";

import { div, label, localize, span } from "../controls";
import { CheckProperty } from "./check";
import { ColorProperty } from "./colorProperty";
import { InputProperty } from "./input";
import { MatrixConverter } from "./matrixConverter";
import style from "./propertyView.module.css";

export class PropertyView extends HTMLElement {
    private panel = div({ className: style.panel });

    constructor(props: { className: string }) {
        super();
        this.classList.add(props.className, style.root);
        this.append(
            label({
                className: style.header,
                textContent: localize("properties.header"),
            }),
            this.panel,
        );
        PubSub.default.sub("showProperties", this.handleShowProperties);
        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
    }

    private handleActiveViewChanged = (view: IView | undefined) => {
        if (view) {
            let nodes = view.document.selection.getSelectedNodes();
            this.handleShowProperties(view.document, nodes);
        }
    };

    private handleShowProperties = (document: IDocument, nodes: INode[]) => {
        this.removeProperties();
        if (nodes.length === 0) return;
        this.addDefault(document, nodes);
        this.addTransform(document, nodes);
        this.addBody(nodes, document);
    };

    private removeProperties() {
        while (this.panel.lastElementChild) {
            this.panel.removeChild(this.panel.lastElementChild);
        }
    }

    private addDefault(document: IDocument, nodes: INode[]) {
        if (nodes.length === 0) return;
        let nameProperty = Property.getProperty(nodes[0], "name")!;
        let header: HTMLElement;
        let properties = div();
        if (INode.isModelNode(nodes[0])) {
            let colorProperty = Property.getProperty(nodes[0], "color")!;
            let opacityProperty = Property.getProperty(nodes[0], "opacity")!;
            header = div(
                { className: style.colorName },
                new ColorProperty(document, nodes, colorProperty, false),
                new InputProperty(document, nodes, nameProperty, false),
            );
            this.appendProperty(properties, document, nodes, opacityProperty);
        } else {
            header = div(
                { className: style.colorName },
                span({ textContent: localize("common.name") }),
                new InputProperty(document, nodes, nameProperty, false),
            );
        }

        this.panel.append(header, properties);
    }

    private addBody(nodes: INode[], document: IDocument) {
        let bodies = nodes.filter((x) => INode.isModelNode(x)).map((x) => (x as GeometryModel).body);
        if (bodies.length === 0 || !this.isAllElementsOfTypeFirstElement(bodies)) return;
        let body = new Expander(bodies[0].name);
        this.panel.append(body);
        body.classList.add(style.expander);
        Property.getProperties(bodies[0]).forEach((x) => {
            this.appendProperty(body.contenxtPanel, document, bodies, x);
        });
    }

    private isAllElementsOfTypeFirstElement(arr: any[]): boolean {
        if (arr.length <= 1) {
            return true;
        }
        const firstElementType = Object.getPrototypeOf(arr[0]).constructor;
        for (let i = 1; i < arr.length; i++) {
            if (Object.getPrototypeOf(arr[i]).constructor !== firstElementType) {
                return false;
            }
        }
        return true;
    }

    private addTransform(document: IDocument, nodes: INode[]) {
        nodes = nodes.filter((x) => INode.isModelNode(x));
        if (nodes.length === 0) return;
        let transform = new Expander("properties.group.transform").addClass(style.expander);
        this.panel.append(transform);
        const addMatrix = (display: I18nKeys, converter: IConverter) => {
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
        const propValue = (objs[0] as unknown as any)[prop.name];
        const type = typeof propValue;
        if (type === "object" || type === "string" || type === "number") {
            if (propValue instanceof Color) {
                container.append(new ColorProperty(document, objs, prop));
            } else {
                container.append(new InputProperty(document, objs, prop));
            }
        } else if (type === "boolean") {
            container.append(new CheckProperty(objs, prop));
        }
    }
}

customElements.define("chili-property-view", PropertyView);
