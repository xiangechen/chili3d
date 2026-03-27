// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "./document";
import {
    type CollectionChangedArgs,
    NodeLinkedListHistoryRecord,
    type NodeRecord,
    Observable,
    ObservableCollection,
    Transaction,
} from "./foundation";
import type { Material } from "./material";
import type { Component } from "./model/component";
import { FolderNode } from "./model/folderNode";
import { type INode, type INodeLinkedList, NodeUtils } from "./model/node";
import { type Serialized, Serializer } from "./serialize";

export type OnNodeChanged = (records: NodeRecord[]) => void;

export class ModelManager extends Observable {
    private readonly _nodeChangedObservers = new Set<OnNodeChanged>();

    readonly components: ObservableCollection<Component> = new ObservableCollection();
    readonly materials: ObservableCollection<Material> = new ObservableCollection();

    private _rootNode: INodeLinkedList | undefined;
    get rootNode(): INodeLinkedList {
        if (this._rootNode === undefined) {
            this._rootNode = this.initRootNode();
        }
        return this._rootNode;
    }
    set rootNode(value: INodeLinkedList) {
        if (this._rootNode === value) return;

        this._rootNode?.removePropertyChanged(this.handleRootNodeNameChanged);
        this._rootNode = value ?? new FolderNode({ document: this.document, name: this.document.name });
        this._rootNode.onPropertyChanged(this.handleRootNodeNameChanged);
    }

    private _currentNode?: INodeLinkedList;
    get currentNode(): INodeLinkedList | undefined {
        return this._currentNode;
    }
    set currentNode(value: INodeLinkedList | undefined) {
        this.setProperty("currentNode", value);
    }

    constructor(readonly document: IDocument) {
        super();
        this.materials.onCollectionChanged(this.handleMaterialChanged);
        this.components.onCollectionChanged(this.handleComponentChanged);
    }

    private readonly handleRootNodeNameChanged = (prop: string) => {
        if (prop === "name") {
            this.document.name = this.rootNode.name;
        }
    };

    initRootNode() {
        return new FolderNode({ document: this.document, name: this.document.name });
    }

    addNodeObserver(observer: OnNodeChanged) {
        this._nodeChangedObservers.add(observer);
    }

    removeNodeObserver(observer: OnNodeChanged) {
        this._nodeChangedObservers.delete(observer);
    }

    notifyNodeChanged(records: NodeRecord[]) {
        Transaction.add(this.document, new NodeLinkedListHistoryRecord(records));
        this._nodeChangedObservers.forEach((x) => {
            x(records);
        });
    }

    addNode(...nodes: INode[]): void {
        (this.currentNode ?? this.rootNode).add(...nodes);
    }

    findNode(predicate: (value: INode) => boolean) {
        if (!this._rootNode) return undefined;

        return NodeUtils.findNode(this._rootNode, predicate);
    }

    findNodes(predicate?: (value: INode) => boolean) {
        if (!this._rootNode) return [];

        return NodeUtils.findNodes(this._rootNode, predicate);
    }

    serialize() {
        return {
            components: this.components.map((x) => Serializer.serializeObject(x)),
            nodes: NodeUtils.serializeNode(this.rootNode),
            materials: this.materials.map((x) => Serializer.serializeObject(x)),
        };
    }

    async deserialize(data: { components: Serialized[]; nodes: Serialized[]; materials: Serialized[] }) {
        this.components.push(
            ...data.components.map((x: Serialized) => Serializer.deserializeObject(this.document, x)),
        );

        this.materials.push(
            ...data.materials.map((x: Serialized) => Serializer.deserializeObject(this.document, x)),
        );

        const rootNode = await NodeUtils.deserializeNode(this.document, data.nodes);
        this.rootNode = rootNode!;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._nodeChangedObservers.clear();
        this.materials.removeCollectionChanged(this.handleMaterialChanged);
        this.components.removeCollectionChanged(this.handleComponentChanged);
        this._rootNode?.removePropertyChanged(this.handleRootNodeNameChanged);
        this._rootNode?.dispose();
        this.materials.forEach((x) => x.dispose());
        this.materials.clear();
        this._rootNode = undefined;
        this._currentNode = undefined;
    }

    private readonly handleMaterialChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            Transaction.add(this.document, {
                name: "MaterialChanged",
                dispose() {},
                undo: () => this.materials.remove(...args.items),
                redo: () => this.materials.push(...args.items),
            });
        } else if (args.action === "remove") {
            Transaction.add(this.document, {
                name: "MaterialChanged",
                dispose() {},
                undo: () => this.materials.push(...args.items),
                redo: () => this.materials.remove(...args.items),
            });
        }
    };

    private readonly handleComponentChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            Transaction.add(this.document, {
                name: "ComponentChanged",
                dispose() {},
                undo: () => this.components.remove(...args.items),
                redo: () => this.components.push(...args.items),
            });
        } else if (args.action === "remove") {
            Transaction.add(this.document, {
                name: "ComponentChanged",
                dispose() {},
                undo: () => this.components.push(...args.items),
                redo: () => this.components.remove(...args.items),
            });
        }
    };
}
