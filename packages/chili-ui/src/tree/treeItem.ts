// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { Transaction } from "chili-core/src/transaction";
import { IModel, IModelGroup, IModelObject } from "chili-geo";
import { Constants, IDisposable } from "chili-shared";
import { Control } from "../control";
import { ModelTree } from "./tree";
import style from "./treeItem.module.css";
import { TreeItemBase } from "./treeItemBase";

export class TreeItem extends TreeItemBase {
    protected handleVisibleClick(): void {
        this.model.visible = !this.model.visible;
    }

    initControls(): void {
        this.dom.appendChild(this.text);
        this.dom.appendChild(this.icon);
    }

    constructor(document: IDocument, model: IModelObject) {
        super(document, model, Control.div(), style.itemPanel);
        this.initControls();
    }

    protected handleDrop(model: IModelObject) {
        model.parentId = this.model.parentId;
    }
}
