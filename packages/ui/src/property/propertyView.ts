// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Binding,
    FolderNode,
    GroupNode,
    type IDocument,
    type IFeatureListNode,
    type INode,
    type IView,
    isFeatureListNode,
    isInstanceNode,
    Localize,
    Node,
    PropertyUtils,
    PubSub,
    VisualNode,
} from "@chili3d/core";
import { button, div, Expander, label, span } from "@chili3d/element";
import commonStyle from "./common.module.css";
import { propertyControl } from "./complexPropertyUtils";
import { FeatureListProperty } from "./featureListProperty";
import { MatrixProperty } from "./matrixProperty";
import style from "./propertyView.module.css";

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
            const nodes = view.document.selection.getSelectedNodes();
            this.handleShowProperties(view.document, nodes);
        }
    };

    private readonly handleShowProperties = (document: IDocument, nodes: INode[]) => {
        this.removeProperties();
        if (nodes.length === 0) return;
        this.addModel(document, nodes);
        this.addGeometry(nodes, document);
        this.addFeatureList(document, nodes);
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
            controls = PropertyUtils.getProperties(Object.getPrototypeOf(nodes[0])).map((x) =>
                propertyControl(document, nodes, x),
            );
        } else if (nodes[0] instanceof Node) {
            controls = PropertyUtils.getOwnProperties(Node.prototype).map((x) =>
                propertyControl(document, nodes, x),
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
        // A parametric body records moves as features (its own transform must stay
        // identity) and a sketch is world-space input; neither takes a direct matrix.
        const direct = geometries.filter(
            (x) =>
                x instanceof GroupNode ||
                ((x as { transformMode?: string }).transformMode ?? "direct") === "direct",
        );
        if (direct.length === 0) return;

        const matrix = new Expander("common.matrix");
        this.panel.append(matrix);

        matrix.contenxtPanel.append(new MatrixProperty(document, direct, style.properties));
    }

    private addParameters(geometries: (VisualNode | GroupNode)[], document: IDocument) {
        const entities = geometries.filter((x) => x instanceof VisualNode);
        if (entities.length === 0 || !this.isAllElementsOfTypeFirstElement(entities)) return;
        const parameters = new Expander(entities[0].display());
        // The source belongs to the instance's own group, next to material/shape type —
        // the same place a feature shows the sketch it references.
        const source = this.instanceSourceRow(document, entities);
        parameters.contenxtPanel.append(
            ...(source === undefined ? [] : [source]),
            ...PropertyUtils.getProperties(Object.getPrototypeOf(entities[0]), Node.prototype).map((x) =>
                propertyControl(document, entities, x),
            ),
        );
        this.panel.append(parameters);
    }

    /**
     * An instance's definition is another node, so its group shows that node the way a
     * feature shows its referenced sketch: a read-only link (click selects, double-click
     * opens). `sourceId` is structural — there is no re-targeting control.
     */
    private instanceSourceRow(document: IDocument, entities: VisualNode[]): HTMLElement | undefined {
        if (entities.length !== 1 || !isInstanceNode(entities[0])) return undefined;
        const source = entities[0].source;
        const target =
            source === undefined
                ? span({
                      className: `${style.reference} ${style.missing}`,
                      textContent: new Localize("body.instance.sourceMissing"),
                  })
                : span({
                      className: style.reference,
                      textContent: new Binding(source, "name"),
                      onclick: () => document.selection.setSelectedNodes([source], false),
                      ondblclick: () => {
                          document.selection.setSelectedNodes([source], false);
                          PubSub.default.pub("nodeDoubleClicked", source);
                      },
                  });

        // The inverse of the link: stop following the source and become an independent
        // copy. It runs the same command as the ribbon, so there is one implementation.
        const detach =
            source === undefined
                ? undefined
                : button({
                      className: style.sourceButton,
                      textContent: new Localize("command.modify.detach"),
                      title: new Localize("command.modify.detach"),
                      onclick: () => {
                          document.selection.setSelectedNodes([entities[0]], false);
                          PubSub.default.pub("executeCommand", "modify.detach");
                      },
                  });

        return div(
            { className: style.param },
            span({
                className: commonStyle.propertyName,
                textContent: new Localize("body.instance.source"),
            }),
            target,
            ...(detach === undefined ? [] : [detach]),
        );
    }

    private addFeatureList(document: IDocument, nodes: INode[]) {
        if (nodes.length !== 1 || !isFeatureListNode(nodes[0])) return;

        const features = new Expander("features.header");
        features.contenxtPanel.append(
            new FeatureListProperty(document, nodes[0] as INode & IFeatureListNode),
        );
        this.panel.append(features);
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
