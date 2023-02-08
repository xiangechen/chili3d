// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    CollectionAction,
    Container,
    ICollection,
    IDocument,
    IHistory,
    ISelection,
    IViewer,
    IVisualization,
    ModelCollection,
    ModelObject,
    Observable,
    PubSub,
    Token,
    Transaction,
} from "chili-core";
import { IVisualizationFactory } from "chili-vis";
import { History } from "./history";

import { Viewer } from "./viewer";

export class Document extends Observable implements IDocument {
    private _name: string;
    readonly models: ModelCollection;
    readonly viewer: IViewer;
    readonly selection: ISelection;
    readonly visualization: IVisualization;
    readonly history: IHistory;

    constructor(name: string, readonly id: string) {
        super();
        this._name = name;
        this.models = new ModelCollection();
        this.history = new History();
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
