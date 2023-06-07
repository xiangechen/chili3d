// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Application,
    Id,
    IDocument,
    ICollectionNode,
    IHistory,
    IVisual,
    Observable,
    PubSub,
    NodeLinkedList,
    ISelection,
    IView,
} from "chili-core";

import { History } from "./history";
import { NodeCollection } from "./nodeCollection";
import { Selection } from "./selection";

export class Document extends Observable implements IDocument {
    private static readonly _documentMap: Map<string, IDocument> = new Map();
    readonly nodes: NodeCollection;
    readonly visual: IVisual;
    readonly history: IHistory;
    readonly rootNode: ICollectionNode;
    readonly selection: ISelection;

    private _name: string;

    get name(): string {
        return this._name;
    }

    set name(name: string) {
        this.setProperty("name", name);
    }

    private _currentNode?: ICollectionNode;

    get currentNode(): ICollectionNode | undefined {
        return this._currentNode;
    }

    set currentNode(value: ICollectionNode | undefined) {
        this.setProperty("currentNode", value);
    }

    private _activeView: IView | undefined;

    get activeView() {
        return this._activeView;
    }

    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value);
    }

    constructor(name: string, readonly id: string = Id.new()) {
        super();
        this._name = name;
        this.nodes = new NodeCollection(this);
        this.history = new History();
        this.rootNode = new NodeLinkedList(this, name);
        this.visual = Application.instance.visualFactory.create(this);
        this.selection = new Selection(this);

        Document.cacheDocument(this);
        PubSub.default.sub("redraw", () => this.visual.viewer.redraw());
    }

    static get(id: string): IDocument | undefined {
        return this._documentMap.get(id);
    }

    private static cacheDocument(document: IDocument) {
        if (this._documentMap.has(document.id)) return;
        this._documentMap.set(document.id, document);
    }

    toJson() {
        return {
            id: this.id,
            name: this._name,
        };
    }

    static fromJson(data: any) {
        let document = new Document(data.name, data.id);
        // data.models.forEach(x => document.addModel(x))
        return document;
    }
}
