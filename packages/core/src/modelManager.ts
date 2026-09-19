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
import { type Material, PhongMaterial } from "./material";
import type { Component } from "./model/component";
import { FolderNode } from "./model/folderNode";
import { type INode, type INodeLinkedList, NodeUtils } from "./model/node";
import { type Serialized, Serializer } from "./serialize";

export type OnNodeChanged = (records: NodeRecord[]) => void;

/** The material reference a node carries, if any — both `GeometryNode` and `MeshNode` have one. */
function materialIdOf(node: INode): string | string[] | undefined {
    return (node as { materialId?: string | string[] }).materialId;
}

/** A node's material reference as a list; a missing one contributes nothing. */
function materialIdsOf(materialId: string | string[] | undefined): readonly string[] {
    if (materialId === undefined) return [];
    return Array.isArray(materialId) ? materialId : [materialId];
}

export class ModelManager extends Observable {
    private readonly _nodeChangedObservers = new Set<OnNodeChanged>();
    private _deserializing = false;

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
        this.rootNode = this.initRootNode();
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
        if (this._deserializing) return;
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
        this.materials.push(
            ...data.materials.map((x: Serialized) => Serializer.deserializeObject(this.document, x)),
        );

        this.components.push(
            ...data.components.map((x: Serialized) => Serializer.deserializeObject(this.document, x)),
        );

        // Defer node notifications until the new tree replaces rootNode: displaying a
        // node mid-load can generate shapes that reference other nodes (e.g. a
        // parametric body referencing a sketch), which findNode cannot reach while
        // _rootNode is still the old root.
        this._deserializing = true;
        try {
            const rootNode = await NodeUtils.deserializeNode(this.document, data.nodes);
            this.rootNode = rootNode!;
            this.ensureMaterials();
        } finally {
            this._deserializing = false;
        }
        this.notifyNodeChanged([{ action: "add", node: this.rootNode }]);
    }

    /**
     * Fills in the materials a loaded document references but its `materials` list no longer
     * holds, so rendering does not throw `Material not found` — the node tree and the material
     * list are separate arrays, and an interrupted or hand-edited save can leave them out of step.
     *
     * The placeholder keeps the referenced id, so every node resolves; it is a grey
     * `PhongMaterial` the user can restyle.
     */
    private ensureMaterials() {
        const known = new Set(this.materials.map((x) => x.id));
        const backfill = (materialId: string | string[] | undefined) => {
            for (const id of materialIdsOf(materialId)) {
                // An empty id is "nothing assigned" — the `GeometryNode` default when the
                // document had no materials yet — not a reference to repair. Backfilling it
                // would write a nameless material into every later save.
                if (id === "" || known.has(id)) continue;
                known.add(id);
                this.materials.push(
                    new PhongMaterial({ id, document: this.document, name: "replaced", color: 0xaaaaaa }),
                );
            }
        };

        // The nodes a component owns hang off the component, not off the linked-list tree,
        // so both walks are needed to cover everything that can carry a `materialId`.
        for (const node of NodeUtils.children(this.rootNode)) backfill(materialIdOf(node));
        for (const component of this.components) {
            for (const node of component.nodes) backfill(materialIdOf(node));
        }
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
