// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, span } from "chili-controls";
import { IDocument, IView, Localize, PubSub } from "chili-core";
import style from "./projectView.module.css";
import { ToolBar } from "./toolBar";
import { Tree } from "./tree";

export class ProjectView extends HTMLElement {
    private readonly _documentTreeMap = new Map<IDocument, Tree>();

    private _activeDocument: IDocument | undefined;
    get activeDocument() {
        return this._activeDocument;
    }

    private readonly panel: HTMLDivElement;

    constructor(props: { className: string }) {
        super();
        this.classList.add(style.root, props.className);
        this.panel = div({
            className: style.itemsPanel,
        });
        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
        PubSub.default.sub("documentClosed", this.handleDocumentClosed);

        this.render();
    }

    private render() {
        this.append(
            div(
                { className: style.headerPanel },
                span({
                    className: style.header,
                    textContent: new Localize("items.header"),
                }),
                new ToolBar(this),
            ),
            this.panel,
        );
    }

    activeTree() {
        if (!this._activeDocument) return undefined;
        return this._documentTreeMap.get(this._activeDocument);
    }

    private readonly handleDocumentClosed = (document: IDocument) => {
        const tree = this._documentTreeMap.get(document);
        if (tree) {
            tree.remove();
            tree.dispose();
            this._documentTreeMap.delete(document);
        }
    };

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        if (this._activeDocument === view?.document) return;

        this._documentTreeMap.get(this._activeDocument!)?.remove();
        this._activeDocument = view?.document;

        if (view) {
            let tree = this._documentTreeMap.get(view.document);
            if (!tree) {
                tree = new Tree(view.document);
                this._documentTreeMap.set(view.document, tree);
            }
            this.panel.append(tree);
        }
    };
}

customElements.define("chili-project-view", ProjectView);
