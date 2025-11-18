// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { HistoryObservable, type IDisposable, Id, type IPropertyChanged } from "../foundation";
import { Property } from "../property";
import { type Serialized, Serializer } from "../serialize";

export interface INode extends IPropertyChanged, IDisposable {
    readonly id: string;
    visible: boolean;
    parentVisible: boolean;
    name: string;
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;
    clone(): this;
}

export interface INodeLinkedList extends INode {
    get firstChild(): INode | undefined;
    get lastChild(): INode | undefined;
    add(...items: INode[]): void;
    remove(...items: INode[]): void;
    transfer(...items: INode[]): void;
    size(): number;
    insertAfter(target: INode | undefined, node: INode): void;
    insertBefore(target: INode | undefined, node: INode): void;
    move(child: INode, newParent: this, newPreviousSibling?: INode): void;
}

export namespace INode {
    export function isLinkedListNode(node: INode): node is INodeLinkedList {
        return (node as INodeLinkedList).add !== undefined;
    }
}

export abstract class Node extends HistoryObservable implements INode {
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;

    @Serializer.serialze()
    readonly id: string;

    constructor(document: IDocument, name: string, id: string) {
        super(document);
        this.id = id;
        this.setPrivateValue("name", name || "untitled");
    }

    @Serializer.serialze()
    @Property.define("common.name")
    get name() {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @Serializer.serialze()
    get visible(): boolean {
        return this.getPrivateValue("visible", true);
    }
    set visible(value: boolean) {
        this.setProperty("visible", value, () => this.onVisibleChanged());
    }

    protected abstract onVisibleChanged(): void;

    get parentVisible() {
        return this.getPrivateValue("parentVisible", true);
    }
    set parentVisible(value: boolean) {
        this.setProperty("parentVisible", value, () => this.onParentVisibleChanged());
    }

    override disposeInternal(): void {
        this.document.visual.context.removeNode([this]);
        super.disposeInternal();
    }

    clone(): this {
        const oldValue = this.document.history.disabled;
        try {
            this.document.history.disabled = true;
            const serialized = Serializer.serializeObject(this);
            serialized.properties["id"] = Id.generate();
            serialized.properties["name"] = `${this.name}_copy`;
            return Serializer.deserializeObject(this.document, serialized) as this;
        } finally {
            this.document.history.disabled = oldValue;
        }
    }

    protected abstract onParentVisibleChanged(): void;
}

export namespace INode {
    export function getNodesBetween(node1: INode, node2: INode): INode[] {
        if (node1 === node2) return [node1];
        const nodes: INode[] = [];
        const prePath = getPathToRoot(node1);
        const curPath = getPathToRoot(node2);
        const index = getCommonParentIndex(prePath, curPath);
        const parent = prePath.at(1 - index) as INodeLinkedList;
        if (parent === curPath[0] || parent === prePath[0]) {
            const child = parent === curPath[0] ? prePath[0] : curPath[0];
            getNodesFromParentToChild(nodes, parent, child);
        } else if (currentAtBack(prePath.at(-index)!, curPath.at(-index)!)) {
            getNodesFromPath(nodes, prePath, curPath, index);
        } else {
            getNodesFromPath(nodes, curPath, prePath, index);
        }
        return nodes;
    }

    function getNodesFromPath(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        nodeOrChildrenAppendToNodes(nodes, path1[0]);
        path1ToCommonNodes(nodes, path1, commonIndex);
        commonToPath2Nodes(nodes, path1, path2, commonIndex);
    }

    function path1ToCommonNodes(nodes: INode[], path1: INode[], commonIndex: number) {
        for (let i = 0; i < path1.length - commonIndex; i++) {
            let next = path1[i].nextSibling;
            while (next !== undefined) {
                INode.nodeOrChildrenAppendToNodes(nodes, next);
                next = next.nextSibling;
            }
        }
    }

    function commonToPath2Nodes(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        let nextParent = path1.at(-commonIndex)?.nextSibling;
        while (nextParent) {
            if (nextParent === path2[0]) {
                nodes.push(path2[0]);
                return;
            }
            if (INode.isLinkedListNode(nextParent)) {
                if (getNodesFromParentToChild(nodes, nextParent, path2[0])) {
                    return;
                }
            } else {
                nodes.push(nextParent);
            }
            nextParent = nextParent.nextSibling;
        }
    }

    export function nodeOrChildrenAppendToNodes(nodes: INode[], node: INode) {
        if (INode.isLinkedListNode(node)) {
            getNodesFromParentToChild(nodes, node);
        } else {
            nodes.push(node);
        }
    }

    export function findTopLevelNodes(nodes: Set<INode>) {
        const result: INode[] = [];
        for (const node of nodes) {
            if (!containsDescendant(nodes, node)) {
                result.push(node);
            }
        }
        return result;
    }

    export function containsDescendant(nodes: Set<INode>, node: INode): boolean {
        if (node.parent === undefined) return false;
        if (nodes.has(node.parent)) return true;
        return containsDescendant(nodes, node.parent);
    }

    function getNodesFromParentToChild(nodes: INode[], parent: INodeLinkedList, until?: INode): boolean {
        nodes.push(parent);
        let node = parent.firstChild;
        while (node !== undefined) {
            if (until === node) {
                nodes.push(node);
                return true;
            }

            if (INode.isLinkedListNode(node)) {
                if (getNodesFromParentToChild(nodes, node, until)) return true;
            } else {
                nodes.push(node);
            }
            node = node.nextSibling;
        }
        return false;
    }

    function currentAtBack(preNode: INode, curNode: INode) {
        while (preNode.nextSibling !== undefined) {
            if (preNode.nextSibling === curNode) return true;
            preNode = preNode.nextSibling;
        }
        return false;
    }

    function getCommonParentIndex(prePath: INode[], curPath: INode[]) {
        let index = 1;
        for (index; index <= Math.min(prePath.length, curPath.length); index++) {
            if (prePath.at(-index) !== curPath.at(-index)) break;
        }
        if (prePath.at(1 - index) !== curPath.at(1 - index)) throw new Error("can not find a common parent");
        return index;
    }

    function getPathToRoot(node: INode): INode[] {
        const path: INode[] = [];
        let parent: INode | undefined = node;
        while (parent !== undefined) {
            path.push(parent);
            parent = parent.parent;
        }
        return path;
    }
}

export namespace NodeSerializer {
    export function serialize(node: INode) {
        const nodes: Serialized[] = [];
        serializeNodeToArray(nodes, node, undefined);
        return nodes;
    }

    function serializeNodeToArray(nodes: Serialized[], node: INode, parentId: string | undefined) {
        const serialized: any = Serializer.serializeObject(node);
        if (parentId) serialized["parentId"] = parentId;
        nodes.push(serialized);

        if (INode.isLinkedListNode(node) && node.firstChild) {
            serializeNodeToArray(nodes, node.firstChild, node.id);
        }
        if (node.nextSibling) {
            serializeNodeToArray(nodes, node.nextSibling, parentId);
        }
        return nodes;
    }

    export async function deserialize(document: IDocument, nodes: Serialized[]) {
        const nodeMap: Map<string, INodeLinkedList> = new Map();
        nodes.forEach((n) => {
            const node = Serializer.deserializeObject(document, n);
            if (INode.isLinkedListNode(node)) {
                nodeMap.set(n.properties["id"], node);
            }
            const parentId = (n as any)["parentId"];
            if (!parentId) return;
            if (nodeMap.has(parentId)) {
                nodeMap.get(parentId)!.add(node);
            } else {
                console.warn("parent not found: " + parentId);
            }
        });
        return Promise.resolve(nodeMap.get(nodes[0].properties["id"]));
    }
}
