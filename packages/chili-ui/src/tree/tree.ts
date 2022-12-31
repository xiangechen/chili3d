// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IModelGroup, IModelObject } from "chili-geo";
import { Control, Div } from "../controls";
import { TreeItem } from "./treeItem";
import style from "./tree.module.css";
import { Constants, Logger } from "chili-shared";
import { IDocument, ModelGroup, PubSub } from "chili-core";
import { TreeToolBar } from "./treeToolBar";
import { ISelection } from "chili-vis";
import { TreeItemBase } from "./treeItemBase";
import { TreeItemGroup } from "./treeItemGroup";

export class ModelTree extends Div {
    private _selecteds?: IModelObject[];
    private _treePanel: Div;
    readonly toolsPanel: TreeToolBar;
    private readonly _modelMap: Map<string, TreeItemBase>;

    constructor(readonly document: IDocument) {
        super(style.treeRoot);
        this._modelMap = new Map<string, TreeItemBase>();
        this.toolsPanel = new TreeToolBar(this);
        this._treePanel = new Div(style.treePanel);
        this.add(this.toolsPanel, this._treePanel);
        this.initTree(document.getModels());
        this._treePanel.dom.addEventListener("click", this.handleItemClick);
        PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
        PubSub.default.sub("modelAdded", this.handleAddModel);
        PubSub.default.sub("modelRemoved", this.handleRemoveModel);
        PubSub.default.sub("parentChanged", this.handleParentChanged);
    }

    handleParentChanged = (model: IModelObject, oldParent: string | undefined, newParent: string | undefined) => {
        let control = this._modelMap.get(model.id);
        if (control === undefined) return;
        if (oldParent !== undefined) {
            let oldParentControl = this._modelMap.get(oldParent);
            oldParentControl?.remove(control);
        }
        if (newParent === undefined) {
            this._treePanel.add(control);
        } else {
            this._modelMap.get(newParent)?.add(control);
        }
    };

    getTreeItem(model: IModelObject) {
        return this._modelMap.get(model.id);
    }

    removeItem(model: IModelObject) {
        let item = this._modelMap.get(model.id);
        if (item !== undefined) {
            this._treePanel.remove(item);
            this._modelMap.delete(model.id);
        }
    }

    initTree(models: IModelObject[]) {
        let box = document.createDocumentFragment();
        models.forEach((x) => this.addItemToGroup(box, x));
        this._treePanel.dom.appendChild(box);
    }

    private addItemToGroup(parent: Node, model: IModelObject) {
        let item = IModelObject.isGroup(model)
            ? new TreeItemGroup(this.document, this, model, true)
            : new TreeItem(this.document, model);

        let tParent = this._modelMap.get(model.id);
        if (tParent === undefined) parent.appendChild(item.dom);
        else tParent.dom.appendChild(item.dom);
        this._modelMap.set(model.id, item);
    }

    private handleItemClick = (e: MouseEvent) => {
        if (e.target instanceof HTMLElement) {
            let modelId = e.target.getAttribute(Constants.ModelIdAttribute);
            if (modelId === null) return;
            if (e.shiftKey === false) {
                let model = this.document.getModel(modelId);
                if (model === undefined) return;
                if (IModelObject.isModel(model)) {
                    this.document.selection.setSelected(false, model);
                } else if (IModelObject.isGroup(model)) {
                    let group = this._modelMap.get(model.id) as TreeItemGroup;
                    group?.setExpander(!group.isExpanded);
                }
            }
            this.document.viewer.redraw();
        }
    };

    treeItems() {
        return this._modelMap.values();
    }

    getSelectedModelObjects() {
        if (this._selecteds === undefined) return undefined;
        return [...this._selecteds];
    }

    private handleSelectionChanged = (document: IDocument, models: IModelObject[]) => {
        this.clearSelectedStyle();
        this.addSelectedStyle(models);
    };

    private handleAddModel = (document: IDocument, model: IModelObject) => {
        let item = IModelObject.isGroup(model)
            ? new TreeItemGroup(this.document, this, model, true)
            : new TreeItem(this.document, model);

        let parent = this._treePanel;
        if (model.parentId !== undefined) {
            let testParent = this._modelMap.get(model.parentId);
            if (testParent === undefined) {
                Logger.error(`没有找到 id 为 ${model.parentId} 的控件`);
                model.parentId = undefined;
            } else {
                parent = testParent;
            }
        }
        parent.add(item);
        this._modelMap.set(model.id, item);
    };

    private handleRemoveModel = (document: IDocument, model: IModelObject) => {
        let li = this._modelMap.get(model.id);
        if (li === undefined) return;
        this._treePanel.remove(li);
        this._modelMap.delete(model.id);
        li.dispose();
    };

    private addSelectedStyle(models?: IModelObject[]) {
        models?.forEach((m) => {
            let li = this._modelMap.get(m.id);
            li?.addClass(style.itemPanelSelected);
        });
        this._selecteds = models?.map((x) => x);
    }

    private clearSelectedStyle() {
        this._selecteds?.forEach((s) => {
            let li = this._modelMap.get(s.id);
            li?.removeClass(style.itemPanelSelected);
        });
        this._selecteds = undefined;
    }
}
