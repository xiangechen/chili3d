// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub } from "chili-core";

import { Control } from "../control";
import { PropertyView } from "../property";
import { CheckProperty } from "../property/check";
import { Tab } from "../tab";
import { ModelTree } from "../tree/tree";
import style from "./sidebar.module.css";

export class Sidebar {
    readonly dom: HTMLDivElement;
    private _activeTree?: ModelTree;
    private readonly _treeMap: WeakMap<IDocument, ModelTree>;
    readonly modelTreePanel: HTMLDivElement;
    readonly propertyViewPanel: HTMLDivElement;

    constructor() {
        this.dom = Control.div(style.sidebar);
        this._treeMap = new WeakMap<IDocument, ModelTree>();
        this.modelTreePanel = Control.div(style.top);
        this.propertyViewPanel = Control.div(style.bottom);
        Control.append(this.dom, this.modelTreePanel, this.propertyViewPanel);
        this.propertyViewPanel.appendChild(new PropertyView().dom);
        PubSub.default.sub("activeDocumentChanged", this.activeDocumentChanged);
    }

    private activeDocumentChanged = (doc?: IDocument) => {
        Control.clear(this.modelTreePanel);
        if (doc === undefined) {
            this._activeTree = undefined;
            return;
        }
        this._activeTree = this._treeMap.get(doc);
        if (this._activeTree === undefined) {
            this._activeTree = new ModelTree(doc);
            this._treeMap.set(doc, this._activeTree);
        }
        this.modelTreePanel.appendChild(this._activeTree.dom);
    };
}
