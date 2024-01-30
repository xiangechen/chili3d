// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, PubSub } from "chili-core";
import { ToolBar } from "./toolBar";
import { Tree } from "./tree";

import { BindableElement, div, localize, span } from "../controls";
import style from "./projectView.module.css";

export class ProjectView extends BindableElement {
    private readonly _documentTreeMap = new WeakMap<IDocument, Tree>();

    private _activeDocument: IDocument | undefined;
    get activeDocument() {
        return this._activeDocument;
    }

    private panel: HTMLDivElement;

    constructor(props: { className: string }) {
        super();
        this.classList.add(style.root, props.className);
        this.panel = div({
            className: style.itemsPanel,
        });
        this.append(
            div(
                { className: style.headerPanel },
                span({
                    className: style.header,
                    textContent: localize("items.header"),
                }),
                new ToolBar(this),
            ),
            this.panel,
        );
        PubSub.default.sub("activeDocumentChanged", this.handleactiveDocumentChanged);
        PubSub.default.sub("documentClosed", this.handleDocumentClosed);
    }

    activeTree() {
        if (!this._activeDocument) return undefined;
        return this._documentTreeMap.get(this._activeDocument);
    }

    private handleDocumentClosed = (document: IDocument) => {
        let tree = this._documentTreeMap.get(document);
        if (tree) this.panel.removeChild(tree);
        this._documentTreeMap.delete(document);
        this._activeDocument = undefined;
    };

    private handleactiveDocumentChanged = (document: IDocument | undefined) => {
        if (this._activeDocument !== undefined && this._documentTreeMap.has(this._activeDocument)) {
            let tree = this._documentTreeMap.get(this._activeDocument)!;
            this.panel.removeChild(tree);
        }
        this._activeDocument = document;
        if (document === undefined) return;

        let tree = this._documentTreeMap.get(document);
        if (tree === undefined) {
            tree = new Tree(document);
            this._documentTreeMap.set(document, tree);
        }
        this.panel.append(tree);
    };
}

customElements.define("chili-project-view", ProjectView);
