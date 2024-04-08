// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    GeometryModel,
    GeometryObject,
    I18nKeys,
    IConverter,
    IDocument,
    INode,
    IView,
    Property,
    PubSub,
} from "chili-core";
import { Expander } from "../components";
import { div, label, localize } from "../controls";
import { InputProperty } from "./input";
import { MatrixConverter } from "./matrixConverter";
import style from "./propertyView.module.css";
import { appendProperty } from "./utils";

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
        this.addModel(document, nodes);
        this.addGeometry(nodes, document);
    };

    private removeProperties() {
        while (this.panel.lastElementChild) {
            this.panel.removeChild(this.panel.lastElementChild);
        }
    }

    private addModel(document: IDocument, nodes: INode[]) {
        if (nodes.length === 0) return;
        let properties = div();
        let header = new InputProperty(document, nodes, Property.getProperty(nodes[0], "name")!);
        if (INode.isModelNode(nodes[0])) {
            appendProperty(properties, document, nodes);
        }

        this.panel.append(header, properties);
    }

    private addGeometry(nodes: INode[], document: IDocument) {
        let geometries = nodes.filter((x) => INode.isModelNode(x)).map((x) => (x as GeometryModel).geometry);
        if (geometries.length === 0 || !this.isAllElementsOfTypeFirstElement(geometries)) return;
        this.addCommon(document, geometries);
        this.addParameters(geometries, document);
    }

    private addCommon(document: IDocument, geometries: GeometryObject[]) {
        let common = new Expander("common.general");
        this.panel.append(common);
        common.classList.add(style.expander);
        Property.getOwnProperties(GeometryObject.prototype).forEach((x) => {
            appendProperty(common.contenxtPanel, document, geometries, x);
        });
        this.addTransform(common, document, geometries);
    }

    private addParameters(geometries: GeometryObject[], document: IDocument) {
        let parameters = new Expander(geometries[0].display);
        this.panel.append(parameters);
        parameters.classList.add(style.expander);
        Property.getProperties(Object.getPrototypeOf(geometries[0]), GeometryObject.prototype).forEach(
            (x) => {
                appendProperty(parameters.contenxtPanel, document, geometries, x);
            },
        );
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

    private addTransform(dom: HTMLElement, document: IDocument, geometries: GeometryObject[]) {
        const addMatrix = (display: I18nKeys, converter: IConverter) => {
            appendProperty(dom, document, geometries, {
                name: "matrix",
                display: display,
                converter,
            });
        };
        // 这部分代码有问题，待完善
        let converters = MatrixConverter.init();
        addMatrix("transform.translation", converters.translation);
        addMatrix("transform.scale", converters.scale);
        addMatrix("transform.rotation", converters.rotate);
    }
}

customElements.define("chili-property-view", PropertyView);
