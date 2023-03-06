// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Constants,
    IDocument,
    Logger,
    GroupModel,
    Model,
    PubSub,
    FlolderEntry,
    CollectionAction,
    IFolder,
    ICollection,
} from "chili-core";
import { customElement } from "../components";

import { Control } from "../control";
import { Tab } from "../tab";
import style from "./tree.module.css";
import { TreeItem } from "./treeItem";
import { TreeItemBase } from "./treeItemBase";
import { TreeItemGroup } from "./treeItemGroup";
import { TreeToolBar } from "./treeToolBar";

@customElement("model-tree")
export class Tree extends HTMLElement {
    readonly folder: FlolderEntry;

    constructor(readonly document: IDocument) {
        super();
        this.folder = document.folder;
        this.appendChild(new TreeGroup(document.folder));
    }
}

@customElement("model-group")
export class TreeGroup extends HTMLElement {
    readonly text: HTMLSpanElement;
    constructor(readonly folder: FlolderEntry) {
        super();
        this.text = document.createElement("span");
        this.text.innerText = folder.name;
        this.appendChild(this.text);
    }

    connectedCallback() {
        this.folder.onPropertyChanged(this.onPropertyChanged);
        this.folder.onCollectionChanged(this.onCollectionChanged);
    }

    disconnectedCallback() {
        this.folder.removePropertyChanged(this.onPropertyChanged);
        this.folder.removeCollectionChanged(this.onCollectionChanged);
    }

    private onPropertyChanged = (source: FlolderEntry, property: keyof FlolderEntry, oldValue: any, newValue: any) => {
        if (property === "name") {
            this.text.innerText = newValue;
        }
    };

    private onCollectionChanged = (source: ICollection<IFolder>, action: CollectionAction, item: IFolder) => {};
}

export class ModelTree {
    readonly dom: HTMLElement;
    private _tab: Tab;
    private _selecteds?: Model[];
    private _treePanel: HTMLDivElement;
    readonly toolsPanel: TreeToolBar;
    private readonly _modelMap: Map<Model, TreeItemBase>;

    constructor(readonly document: IDocument) {
        this._tab = new Tab("items.header");
        this.dom = this._tab.dom;
        this._modelMap = new Map<Model, TreeItemBase>();
        this.toolsPanel = new TreeToolBar(this);
        this._treePanel = Control.div(style.treePanel);
        this._tab.addItem(this._treePanel);
        this._tab.addTools(...this.toolsPanel.tools);
        this.initTree(document.models.getMany());
        this._treePanel.addEventListener("click", this.handleItemClick);
        PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
        PubSub.default.sub("modelAdded", this.handleAddModel);
        PubSub.default.sub("modelRemoved", this.handleRemoveModel);
        PubSub.default.sub("parentChanged", this.handleParentChanged);
    }

    handleParentChanged = (model: Model, oldParent: GroupModel | undefined, newParent: GroupModel | undefined) => {
        let control = this._modelMap.get(model);
        if (control === undefined) return;
        if (oldParent !== undefined) {
            let oldParentControl = this._modelMap.get(oldParent);
            if (oldParentControl instanceof TreeItemGroup) {
                oldParentControl?.remove(control.dom);
            }
        }
        if (newParent === undefined) {
            this._treePanel.appendChild(control.dom);
        } else {
            let parent = this._modelMap.get(newParent);
            if (parent instanceof TreeItemGroup) {
                parent.add(control.dom);
            }
        }
    };

    getTreeItem(model: Model) {
        return this._modelMap.get(model);
    }

    removeItem(model: Model) {
        let item = this._modelMap.get(model);
        if (item === undefined) return;
        if (model.parent !== undefined) {
            let testParent = this._modelMap.get(model.parent);
            if (testParent === undefined) {
                Logger.error(`没有找到 id 为 ${model.parent.id} 的控件`);
            } else if (testParent instanceof TreeItemGroup) {
                testParent.remove(item.dom);
            }
        } else {
            this._treePanel.removeChild(item.dom);
        }
        this._modelMap.delete(model);
        item.dispose();
    }

    initTree(models: Model[]) {
        let box = document.createDocumentFragment();
        models.forEach((x) => this.addItemToGroup(box, x));
        this._treePanel.appendChild(box);
    }

    private addItemToGroup(parent: Node, model: Model) {
        let item = Model.isGroup(model)
            ? new TreeItemGroup(this.document, this, model, true)
            : new TreeItem(this.document, model);

        let tParent = this._modelMap.get(model);
        if (tParent === undefined) parent.appendChild(item.dom);
        else tParent.dom.appendChild(item.dom);
        this._modelMap.set(model, item);
    }

    private handleItemClick = (e: MouseEvent) => {
        if (e.target instanceof HTMLElement) {
            let modelId = e.target.getAttribute(Constants.ModelIdAttribute);
            if (modelId === null) return;
            if (e.shiftKey === false) {
                let model = this.document.models.get(modelId);
                if (model === undefined) return;
                if (Model.isGeometry(model)) {
                    this.document.visualization.selection.setSelected(false, model);
                } else if (Model.isGroup(model)) {
                    let group = this._modelMap.get(model) as TreeItemGroup;
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

    private handleSelectionChanged = (document: IDocument, models: Model[]) => {
        this.clearSelectedStyle();
        this.addSelectedStyle(models);
    };

    private handleAddModel = (document: IDocument, model: Model) => {
        let item = Model.isGroup(model)
            ? new TreeItemGroup(this.document, this, model, true)
            : new TreeItem(this.document, model);

        if (model.parent !== undefined) {
            let testParent = this._modelMap.get(model.parent);
            if (testParent === undefined) {
                Logger.error(`没有找到 id 为 ${model.parent.id} 的控件`);
                model.parent = undefined;
            } else if (testParent instanceof TreeItemGroup) {
                testParent.add(item.dom);
            }
        } else {
            this._treePanel.appendChild(item.dom);
        }
        this._modelMap.set(model, item);
    };

    private handleRemoveModel = (document: IDocument, model: Model) => {
        this.removeItem(model);
    };

    private addSelectedStyle(models?: Model[]) {
        models?.forEach((m) => {
            let li = this._modelMap.get(m);
            li?.dom.classList.add(style.itemPanelSelected);
        });
        this._selecteds = models?.map((x) => x);
    }

    private clearSelectedStyle() {
        this._selecteds?.forEach((s) => {
            let li = this._modelMap.get(s);
            li?.dom.classList.remove(style.itemPanelSelected);
        });
        this._selecteds = undefined;
    }
}
