// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Constants,
    History,
    IApplication,
    IDocument,
    IModel,
    INode,
    INodeLinkedList,
    ISerialize,
    IVisual,
    Id,
    Logger,
    NodeAction,
    NodeLinkedList,
    NodeRecord,
    Observable,
    PubSub,
    SelectionManager,
    Serialized,
    Serializer,
} from "chili-core";

export class Document extends Observable implements IDocument, ISerialize {
    readonly visual: IVisual;
    readonly history: History;
    readonly selection: SelectionManager;

    private _name: string;
    get name(): string {
        return this._name;
    }
    set name(name: string) {
        if (this.name === name) return;
        this.setProperty("name", name);
        if (this.#rootNode) this.#rootNode.name = name;
    }

    #rootNode: INodeLinkedList | undefined;
    get rootNode(): INodeLinkedList {
        if (this.#rootNode === undefined) {
            this.setRootNode(new NodeLinkedList(this, this._name));
        }
        return this.#rootNode!;
    }

    private setRootNode(value: INodeLinkedList) {
        if (this.#rootNode === value) return;
        this.#rootNode?.removePropertyChanged(this.handleRootNodeNameChanged);
        this.#rootNode = value;
        this.#rootNode.onPropertyChanged(this.handleRootNodeNameChanged);
    }

    private _currentNode?: INodeLinkedList;
    get currentNode(): INodeLinkedList | undefined {
        return this._currentNode;
    }
    set currentNode(value: INodeLinkedList | undefined) {
        this.setProperty("currentNode", value);
    }

    constructor(
        readonly application: IApplication,
        name: string,
        readonly id: string = Id.new(),
    ) {
        super();
        this._name = name;
        this.history = new History();
        this.visual = application.visualFactory.create(this);
        this.selection = new SelectionManager(this);
        PubSub.default.sub("nodeLinkedListChanged", this.handleModelChanged);
        Logger.info(`new document: ${name}`);
    }

    private handleRootNodeNameChanged = (prop: string) => {
        if (prop === "name") {
            this.name = this.rootNode.name;
        }
    };

    override serialize(): Serialized {
        return {
            classKey: "Document",
            constructorParameters: {
                id: this.id,
                name: this.name,
            },
            properties: {
                rootNode: this.rootNode.serialize(),
            },
        };
    }

    override dispose(): void {
        super.dispose();
        this.visual.dispose();
        this.history.dispose();
        this.selection.dispose();
        this.#rootNode?.removePropertyChanged(this.handleRootNodeNameChanged);
        this.#rootNode?.dispose();
        this.#rootNode = undefined;
        this._currentNode = undefined;
    }

    async save() {
        let data = this.serialize();
        await this.application.storage.put(Constants.DBName, Constants.DocumentTable, this.id, data);
        let image = await this.visual.viewer.activeView?.toImage();
        await this.application.storage.put(Constants.DBName, Constants.RecentTable, this.id, {
            id: this.id,
            name: this.name,
            date: Date.now(),
            image,
        });
    }

    async close() {
        await this.save();
        this.dispose();
        Logger.info(`document: ${this._name} closed`);
        PubSub.default.pub("documentClosed", this);
        this.application.activeDocument = undefined;
    }

    static async open(application: IApplication, id: string) {
        let data = (await application.storage.get(
            Constants.DBName,
            Constants.DocumentTable,
            id,
        )) as Serialized;
        if (data === undefined) {
            Logger.warn(`document: ${id} not find`);
            return;
        }
        let document = this.load(application, data);
        Logger.info(`document: ${document.name} opened`);
        return document;
    }

    static load(app: IApplication, data: Serialized) {
        let document = new Document(
            app,
            data.constructorParameters["name"],
            data.constructorParameters["id"],
        );
        document.history.disabled = true;
        document.setRootNode(Serializer.deserialize(document, data.properties["rootNode"]));
        document.history.disabled = false;
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
}
