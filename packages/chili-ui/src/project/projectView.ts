// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, IView, PubSub } from "chili-core";
import { ToolBar } from "./toolBar";
import { Tree } from "./tree";

import { div, localize, span } from "../components";
import style from "./projectView.module.css";

export class ProjectView extends HTMLElement {
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
        PubSub.default.sub("activeViewChanged", this.handleactiveViewChanged);
    }

    activeTree() {
        if (!this._activeDocument) return undefined;
        return this._documentTreeMap.get(this._activeDocument);
    }

    private handleactiveViewChanged = (view: IView | undefined) => {
        if (this._activeDocument === view?.document) return;

        if (this._activeDocument !== undefined) {
            this._documentTreeMap.get(this._activeDocument)?.remove();
        }

        this._activeDocument = view?.document;
        if (view === undefined) return;

        let tree = this._documentTreeMap.get(view.document);
        if (tree === undefined) {
            tree = new Tree(view.document);
            this._documentTreeMap.set(view.document, tree);
        }
        this.panel.append(tree);
    };
}

customElements.define("chili-project-view", ProjectView);
