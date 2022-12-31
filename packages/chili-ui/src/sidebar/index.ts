// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub } from "chili-core";
import { IModelObject } from "chili-geo";
import { Div } from "../controls";
import { ModelTree } from "../tree/tree";
import style from "./sidebar.module.css";
import { ISelection } from "chili-vis";
import { CheckProperty } from "../property/check";
import { PropertyView } from "../property";

export class Sidebar extends Div {
    private _activeTree?: ModelTree;
    private readonly _treeMap: WeakMap<IDocument, ModelTree>;
    readonly modelTreePanel: Div;
    readonly propertyViewPanel: Div;

    constructor() {
        super(style.sidebar);
        this._treeMap = new WeakMap<IDocument, ModelTree>();
        this.modelTreePanel = new Div(style.top);
        this.propertyViewPanel = new Div(style.bottom);
        this.add(this.modelTreePanel, this.propertyViewPanel);
        this.propertyViewPanel.add(new PropertyView());
        PubSub.default.sub("activeDocumentChanged", this.activeDocumentChanged);
    }

    private activeDocumentChanged = (doc?: IDocument) => {
        this.modelTreePanel.clear();
        if (doc === undefined) {
            this._activeTree = undefined;
            return;
        }
        this._activeTree = this._treeMap.get(doc);
        if (this._activeTree === undefined) {
            this._activeTree = new ModelTree(doc);
            this._treeMap.set(doc, this._activeTree);
        }
        this.modelTreePanel.add(this._activeTree);
    };
}
