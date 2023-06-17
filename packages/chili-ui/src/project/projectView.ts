// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub } from "chili-core";
import { Control, Label, Panel, Row } from "../components";
import { ToolBar } from "./toolBar";
import { Tree } from "./tree";

import style from "./projectView.module.css";

export class ProjectView extends Control {
    private documentTreeMap = new WeakMap<IDocument, Tree>();
    private activeDocument: IDocument | undefined;
    private panel: Panel;

    constructor() {
        super(style.root);
        this.panel = new Panel().addClass(style.itemsPanel);
        this.append(
            new Row()
                .addClass(style.headerPanel)
                .addItems(new Label().addClass(style.header).i18nText("items.header"), new ToolBar()),
            this.panel
        );
        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
        PubSub.default.sub("documentClosed", this.handleDocumentClosed);
    }

    private handleDocumentClosed = (document: IDocument) => {
        let tree = this.documentTreeMap.get(document);
        if (tree) this.panel.removeChild(tree);
        this.documentTreeMap.delete(document);
        this.activeDocument = undefined;
    };

    private handleActiveDocumentChanged = (document: IDocument | undefined) => {
        if (this.activeDocument !== undefined && this.documentTreeMap.has(this.activeDocument)) {
            let tree = this.documentTreeMap.get(this.activeDocument)!;
            this.panel.removeChild(tree);
        }
        this.activeDocument = document;
        if (document === undefined) return;

        let tree = this.documentTreeMap.get(document);
        if (tree === undefined) {
            tree = new Tree(document);
            this.documentTreeMap.set(document, tree);
        }
        this.panel.append(tree);
    };
}

customElements.define("chili-project-view", ProjectView);
