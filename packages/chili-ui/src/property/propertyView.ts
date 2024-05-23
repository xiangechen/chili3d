// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    GeometryEntity,
    GeometryModel,
    I18nKeys,
    IConverter,
    IDocument,
    INode,
    IView,
    ParameterGeometryEntity,
    Property,
    PubSub,
} from "chili-core";
import { Expander, div, label, localize } from "../components";
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
        this.addGeneral(document, geometries);
        this.addTransform(document, geometries);
        this.addParameters(geometries, document);
    }

    private addGeneral(document: IDocument, geometries: GeometryEntity[]) {
        let common = new Expander("common.general");
        this.panel.append(common);
        common.classList.add(style.expander);
        Property.getOwnProperties(GeometryEntity.prototype).forEach((x) => {
            appendProperty(common.contenxtPanel, document, geometries, x);
        });
    }

    private addTransform(document: IDocument, geometries: GeometryEntity[]) {
        let matrix = new Expander("common.matrix");
        this.panel.append(matrix);
        matrix.classList.add(style.expander);

        const addMatrix = (display: I18nKeys, converter: IConverter) => {
            appendProperty(matrix, document, geometries, {
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

    private addParameters(geometries: GeometryEntity[], document: IDocument) {
        let entities = geometries
            .map((x) => (x as ParameterGeometryEntity).body)
            .filter((x) => x !== undefined);
        if (entities.length === 0 || !this.isAllElementsOfTypeFirstElement(entities)) return;
        let parameters = new Expander(entities[0].display);
        this.panel.append(parameters);
        parameters.classList.add(style.expander);
        Property.getProperties(Object.getPrototypeOf(entities[0])).forEach((x) => {
            appendProperty(parameters.contenxtPanel, document, entities, x);
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
}

customElements.define("chili-property-view", PropertyView);
