// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Application,
    History,
    IDocument,
    IModel,
    INode,
    INodeLinkedList,
    ISelection,
    IView,
    IVisual,
    Id,
    NodeAction,
    NodeLinkedList,
    NodeRecord,
    Observable,
    PubSub,
} from "chili-core";

import { Selection } from "./selection";

export class Document extends Observable implements IDocument {
    private static readonly _documentMap: Map<string, IDocument> = new Map();
    readonly visual: IVisual;
    readonly history: History;
    readonly rootNode: INodeLinkedList;
    readonly selection: ISelection;

    private _name: string;

    get name(): string {
        return this._name;
    }

    set name(name: string) {
        this.setProperty("name", name);
    }

    private _currentNode?: INodeLinkedList;

    get currentNode(): INodeLinkedList | undefined {
        return this._currentNode;
    }

    set currentNode(value: INodeLinkedList | undefined) {
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
        this.history = new History();
        this.rootNode = new NodeLinkedList(this, name);
        this.visual = Application.instance.visualFactory.create(this);
        this.selection = new Selection(this);

        Document.cacheDocument(this);
        PubSub.default.sub("nodeLinkedListChanged", this.handleModelChanged);
        PubSub.default.sub("redraw", () => this.visual.viewer.redraw());
    }

    save(): void {
        let data = this.rootNode.serialize();
        console.log(data);
    }

    private handleModelChanged = (records: NodeRecord[]) => {
        let adds: INode[] = [];
        let rms: INode[] = [];
        records.forEach((x) => {
            if (x.action === NodeAction.add) {
                INode.addNodeOrChildrenToNodes(adds, x.node);
            } else if (x.action === NodeAction.remove) {
                INode.addNodeOrChildrenToNodes(rms, x.node);
            }
        });
        this.visual.context.addModel(adds.filter((x) => !INode.isLinkedListNode(x)) as IModel[]);
        this.visual.context.removeModel(rms.filter((x) => !INode.isLinkedListNode(x)) as IModel[]);
    };

    static get(id: string): IDocument | undefined {
        return this._documentMap.get(id);
    }

    private static cacheDocument(document: IDocument) {
        if (this._documentMap.has(document.id)) return;
        this._documentMap.set(document.id, document);
    }

    addNode(...nodes: INode[]): void {
        (this.currentNode ?? this.rootNode).add(...nodes);
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
