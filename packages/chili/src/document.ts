// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Application,
    History,
    IDocument,
    IModel,
    INode,
    INodeLinkedList,
    ISelection,
    ISerialize,
    IView,
    IVisual,
    Id,
    NodeAction,
    NodeLinkedList,
    NodeRecord,
    Observable,
    PubSub,
    Serialize,
    Serialized,
    Storage,
} from "chili-core";
import { Selection } from "./selection";

const DBName = "chili3d";
const StoreName = "documents";

export class Document extends Observable implements IDocument, ISerialize {
    readonly visual: IVisual;
    readonly history: History;
    readonly selection: ISelection;

    private _name: string;

    get name(): string {
        return this._name;
    }
    set name(name: string) {
        this.setProperty("name", name);
    }

    private _rootNode: INodeLinkedList | undefined;

    get rootNode(): INodeLinkedList {
        if (this._rootNode === undefined) {
            this._rootNode = new NodeLinkedList(this, this._name);
        }
        return this._rootNode;
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
        this.visual = Application.instance.visualFactory.create(this);
        this.selection = new Selection(this);

        PubSub.default.sub("nodeLinkedListChanged", this.handleModelChanged);
    }

    override serialize(): Serialized {
        return {
            type: Document.name,
            id: this.id,
            name: this.name,
            rootNode: this.rootNode.serialize(),
        };
    }

    async save() {
        let data = this.serialize();
        let db = await Storage.open(DBName, StoreName);
        await Storage.put(db, StoreName, this.name, data);
    }

    close() {}

    static async open(name: string) {
        let db = await Storage.open(DBName, StoreName);
        let data = (await Storage.get(db, StoreName, name)) as Serialized;
        return this.load(data);
    }

    static load(data: Serialized) {
        let document = new Document(data["name"], data["id"]);
        let rootData = data["rootNode"];
        let rootNode = new NodeLinkedList(document, rootData["name"], rootData["id"]);
        document._rootNode = rootNode;
        const parentMap = new Map<INodeLinkedList, INode[]>();
        this.getNodes(parentMap, document, rootNode, rootData["firstChild"]);
        try {
            document.history.disabled = true;
            for (const kv of parentMap) {
                kv[0].add(...kv[1]);
            }
        } finally {
            document.history.disabled = false;
        }
        return document;
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

    addNode(...nodes: INode[]): void {
        (this.currentNode ?? this.rootNode).add(...nodes);
    }

    private static getNodes(
        map: Map<INodeLinkedList, INode[]>,
        document: IDocument,
        parent: INodeLinkedList,
        data: Serialized
    ) {
        data["document"] = document;
        if (!map.has(parent)) map.set(parent, []);
        let node = this.createInstance(data);
        map.get(parent)!.push(node);
        if (data["firstChild"]) this.getNodes(map, document, node, data["firstChild"]);
        if (data["nextSibling"]) this.getNodes(map, document, parent, data["nextSibling"]);
    }

    private static createInstance(data: Serialized) {
        for (const key of Object.keys(data)) {
            if (key === "firstChild" || key === "nextSibling") continue; // 不生成嵌套节点
            if (data[key]?.type) data[key] = this.createInstance(data[key]);
        }
        let create = Serialize.getDeserialize(data.type);
        if (create === undefined)
            throw new Error(`The type of ${data.type} is unknown and cannot be loaded.`);
        return create(data);
    }
}
