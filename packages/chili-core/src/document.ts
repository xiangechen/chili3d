// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IViewer, PubSub, History, Viewer, ModelCollection } from "chili-core";
import { IModelGroup, IModelObject } from "chili-geo";
import { CollectionAction, ICollection, Logger, ObservableBase, Token, Container } from "chili-shared";
import { IVisualization, ISelection, IVisualizationFactory } from "chili-vis";
import { Transaction } from "./transaction";

export class Document extends ObservableBase implements IDocument {
    private _name: string;
    readonly models: ModelCollection;
    readonly viewer: IViewer;
    readonly selection: ISelection;
    readonly visualization: IVisualization;

    constructor(name: string, readonly id: string) {
        super();
        this._name = name;
        this.models = new ModelCollection();
        this.viewer = new Viewer(this);
        this.visualization = this.getRender();
        this.selection = this.visualization.selection;
        this.models.onCollectionChanged(this.handleModelCollectionChanged);
    }

    private getRender(): IVisualization {
        let renderFactory = Container.default.resolve<IVisualizationFactory>(Token.VisulizationFactory);
        return renderFactory!.create(this);
    }

    get name(): string {
        return this._name;
    }

    set name(name: string) {
        this.setProperty("name", name);
    }

    get modelCount(): number {
        return this.models.size();
    }

    getParent(model: IModelObject): IModelGroup | undefined {
        if (model.parentId === undefined) return undefined;
        return this.models.get(model.parentId) as IModelGroup;
    }

    getModel(id: string): IModelObject | undefined {
        return this.models.get(id);
    }

    getModels(...ids: string[]): IModelObject[] {
        let result: IModelObject[] = [];
        for (const id of ids) {
            let model = this.models.get(id);
            if (model !== undefined) {
                result.push(model);
            }
        }
        return result;
    }

    getChildren(parentId: string): IModelObject[] {
        let res: IModelObject[] = [];
        for (const iterator of this.models.entry()) {
            if (iterator.parentId === parentId) res.push(iterator);
        }
        return res;
    }

    addModel(...models: IModelObject[]) {
        models.forEach((model) => {
            this.models.add(model);
            model.onPropertyChanged(this.handleModelPropertyChanged);
        });
    }

    removeModel(...models: IModelObject[]) {
        models.forEach((model) => {
            if (IModelObject.isGroup(model)) {
                for (const it of this.models.entry()) {
                    if (it.parentId === model.id) this.removeModel(it);
                }
            }
            this.models.remove(model);
            model.removePropertyChanged(this.handleModelPropertyChanged);
        });
    }

    dispose() {}

    undo() {
        Logger.info("document undo");
        this.undoRedoAction(() => History.get(this).undo());
    }

    redo() {
        Logger.info("document redo");
        this.undoRedoAction(() => History.get(this).redo());
    }

    toJson() {
        return {
            id: this.id,
            name: this._name,
            models: [...this.models.entry()],
        };
    }

    static fromJson(data: any) {
        let document = new Document(data.name, data.id);
        // data.models.forEach(x => document.addModel(x))
        return document;
    }

    private undoRedoAction(action: () => void) {
        let models = this.selection.getSelectedModels();
        this.selection.unSelected(...models);
        action();
        this.selection.setSelected(false, ...models);
        this.viewer.redraw();
    }

    private handleModelCollectionChanged = (
        source: ICollection<IModelObject>,
        action: CollectionAction,
        item: IModelObject
    ) => {
        Transaction.add(this, {
            name: `collection ${String(action)}`,
            action,
            collection: source,
            item,
        });
        if (action === CollectionAction.add) {
            PubSub.default.pub("modelAdded")(this, item);
        } else if (action === CollectionAction.remove) {
            PubSub.default.pub("modelRemoved")(this, item);
        }
    };

    private handleModelPropertyChanged = (source: IModelObject, property: string, oldValue: any, newValue: any) => {
        Transaction.add(this, {
            name: `modify ${String(property)}`,
            object: source,
            property,
            oldValue,
            newValue,
        });
    };
}
