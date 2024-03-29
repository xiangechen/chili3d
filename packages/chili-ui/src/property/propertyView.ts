// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    GeometryModel,
    I18nKeys,
    IConverter,
    IDocument,
    IModel,
    INode,
    IView,
    Property,
    PubSub,
} from "chili-core";
import { Expander } from "../components";

import { button, div, label, localize, span } from "../controls";
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
        let properties = div();
        let header = new InputProperty(document, nodes, Property.getProperty(nodes[0], "name")!);
        if (INode.isModelNode(nodes[0])) {
            appendProperty(properties, document, nodes);
            if (nodes.length === 1) {
                this.appendMaterialProperty(document, nodes[0], properties);
            }
        }

        this.panel.append(header, properties);
    }

    private appendMaterialProperty(document: IDocument, model: IModel, properties: HTMLDivElement) {
        const findMaterial = (id: string) => document.materials.find((x) => x.id === id)!;
        properties.append(
            div(
                {
                    className: style.material,
                },
                span({
                    textContent: localize(Property.getProperty(model, "materialId")!.display),
                }),
                button({
                    textContent: findMaterial(model.materialId).name,
                    onclick: (e) => {
                        PubSub.default.pub(
                            "editMaterial",
                            document,
                            findMaterial(model.materialId)!,
                            (material) => {
                                let button = e.target as HTMLButtonElement;
                                button.textContent = material.name;
                                model.materialId = material.id;
                                console.log(model.materialId);

                                document.visual.update();
                            },
                        );
                    },
                }),
            ),
        );
    }

    private addBody(nodes: INode[], document: IDocument) {
        let bodies = nodes.filter((x) => INode.isModelNode(x)).map((x) => (x as GeometryModel).body);
        if (bodies.length === 0 || !this.isAllElementsOfTypeFirstElement(bodies)) return;
        let body = new Expander(bodies[0].name);
        this.panel.append(body);
        body.classList.add(style.expander);
        Property.getProperties(bodies[0]).forEach((x) => {
            appendProperty(body.contenxtPanel, document, bodies, x);
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
            appendProperty(transform, document, nodes, {
                name: "matrix",
                display: display,
                converter,
            });
        };
        // 这部分代码有问题，待完善
        let converters = MatrixConverter.init();
        addMatrix("model.translation", converters.translation);
        addMatrix("model.scale", converters.scale);
        addMatrix("model.rotation", converters.rotate);
    }
}

customElements.define("chili-property-view", PropertyView);
