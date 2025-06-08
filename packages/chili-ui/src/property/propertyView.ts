// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, Expander, label } from "chili-controls";
import {
    FolderNode,
    GroupNode,
    IDocument,
    INode,
    IView,
    Localize,
    Node,
    Property,
    PubSub,
    VisualNode,
} from "chili-core";
import { MatrixProperty } from "./matrixProperty";
import style from "./propertyView.module.css";
import { findPropertyControl } from "./utils";

export class PropertyView extends HTMLElement {
    private readonly panel = div({ className: style.panel });

    constructor(props: { className: string }) {
        super();
        this.classList.add(props.className, style.root);
        this.append(
            label({
                className: style.header,
                textContent: new Localize("properties.header"),
            }),
            this.panel,
        );
        PubSub.default.sub("showProperties", this.handleShowProperties);
        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
    }

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        if (view) {
            let nodes = view.document.selection.getSelectedNodes();
            this.handleShowProperties(view.document, nodes);
        }
    };

    private readonly handleShowProperties = (document: IDocument, nodes: INode[]) => {
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

        let controls: (HTMLElement | string)[] = [];
        if (nodes[0] instanceof FolderNode) {
            controls = Property.getProperties(Object.getPrototypeOf(nodes[0])).map((x) =>
                findPropertyControl(document, nodes, x),
            );
        } else if (nodes[0] instanceof Node) {
            controls = Property.getOwnProperties(Node.prototype).map((x) =>
                findPropertyControl(document, nodes, x),
            );
        }

        this.panel.append(div({ className: style.properties }, ...controls));
    }

    private addGeometry(nodes: INode[], document: IDocument) {
        const geometries = nodes.filter((x) => x instanceof VisualNode || x instanceof GroupNode);
        if (geometries.length === 0 || !this.isAllElementsOfTypeFirstElement(geometries)) return;
        this.addTransform(document, geometries);
        this.addParameters(geometries, document);
    }

    private addTransform(document: IDocument, geometries: (VisualNode | GroupNode)[]) {
        const matrix = new Expander("common.matrix");
        this.panel.append(matrix);

        matrix.contenxtPanel.append(new MatrixProperty(document, geometries, style.properties));
    }

    private addParameters(geometries: (VisualNode | GroupNode)[], document: IDocument) {
        const entities = geometries.filter((x) => x instanceof VisualNode);
        if (entities.length === 0 || !this.isAllElementsOfTypeFirstElement(entities)) return;
        const parameters = new Expander(entities[0].display());
        parameters.contenxtPanel.append(
            ...Property.getProperties(Object.getPrototypeOf(entities[0]), Node.prototype).map((x) =>
                findPropertyControl(document, entities, x),
            ),
        );
        this.panel.append(parameters);
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
