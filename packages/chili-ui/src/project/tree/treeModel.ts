// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, INode } from "chili-core";
import { TreeItem } from "./treeItem";
import style from "./treeModel.module.css";

export class TreeModel extends TreeItem {
    constructor(document: IDocument, node: INode) {
        super(document, node);
        this.append(this.name, this.visibleIcon);
        this.classList.add(style.panel);
    }

    getSelectedHandler(): HTMLElement {
        return this;
    }
}

customElements.define("tree-model", TreeModel);
