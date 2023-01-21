// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    IViewer,
    PubSub,
    History,
    ModelCollection,
    Transaction,
    IVisualization,
    ISelection,
    ModelObject,
} from "chili-core";
import { CollectionAction, ICollection, Logger, Observable, Token, Container } from "chili-shared";
import { IVisualizationFactory } from "chili-vis";
import { Viewer } from "./viewer";

export class Document extends Observable implements IDocument {
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

    getModel(id: string): ModelObject | undefined {
        return this.models.get(id);
    }

    getModels(...ids: string[]): ModelObject[] {
        let result: ModelObject[] = [];
        for (const id of ids) {
            let model = this.models.get(id);
            if (model !== undefined) {
                result.push(model);
            }
        }
        return result;
    }

    addModel(...models: ModelObject[]) {
        models.forEach((model) => {
            model.setDocument(this);
            this.models.add(model);
        });
    }

    removeModel(...models: ModelObject[]) {
        models.forEach((model) => {
            if (ModelObject.isGroup(model)) {
                for (const it of this.models.entry()) {
                    if (it.parent === model && it instanceof ModelObject) this.removeModel(it);
                }
            }
            this.models.remove(model);
            model.setDocument(undefined);
        });
    }

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
        source: ICollection<ModelObject>,
        action: CollectionAction,
        item: ModelObject
    ) => {
        Transaction.add(this, {
            name: `collection ${String(action)}`,
            action,
            collection: source,
            item,
        });
        if (action === CollectionAction.add) {
            PubSub.default.pub("modelAdded", this, item);
        } else if (action === CollectionAction.remove) {
            PubSub.default.pub("modelRemoved", this, item);
        }
    };
}
