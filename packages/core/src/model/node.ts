// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { HistoryObservable, type IDisposable, Id, type IPropertyChanged } from "../foundation";
import { property } from "../property";
import { type Serialized, Serializer, serialze } from "../serialize";

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

export abstract class Node extends HistoryObservable implements INode {
    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;
    nextSibling: INode | undefined;

    @serialze()
    readonly id: string;

    constructor(document: IDocument, name: string, id: string) {
        super(document);
        this.id = id;
        this.setPrivateValue("name", name || "untitled");
    }

    @serialze()
    @property("common.name")
    get name() {
        return this.getPrivateValue("name");
    }
    set name(value: string) {
        this.setProperty("name", value);
    }

    @serialze()
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

export class NodeUtils {
    public static isLinkedListNode(node: INode): node is INodeLinkedList {
        return (node as INodeLinkedList).add !== undefined;
    }

    static getNodesBetween(node1: INode, node2: INode): INode[] {
        if (node1 === node2) return [node1];
        const nodes: INode[] = [];
        const prePath = NodeUtils.getPathToRoot(node1);
        const curPath = NodeUtils.getPathToRoot(node2);
        const index = NodeUtils.getCommonParentIndex(prePath, curPath);
        const parent = prePath.at(1 - index) as INodeLinkedList;
        if (parent === curPath[0] || parent === prePath[0]) {
            const child = parent === curPath[0] ? prePath[0] : curPath[0];
            NodeUtils.getNodesFromParentToChild(nodes, parent, child);
        } else if (NodeUtils.currentAtBack(prePath.at(-index)!, curPath.at(-index)!)) {
            NodeUtils.getNodesFromPath(nodes, prePath, curPath, index);
        } else {
            NodeUtils.getNodesFromPath(nodes, curPath, prePath, index);
        }
        return nodes;
    }

    static getNodesFromPath(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        NodeUtils.nodeOrChildrenAppendToNodes(nodes, path1[0]);
        NodeUtils.path1ToCommonNodes(nodes, path1, commonIndex);
        NodeUtils.commonToPath2Nodes(nodes, path1, path2, commonIndex);
    }

    static path1ToCommonNodes(nodes: INode[], path1: INode[], commonIndex: number) {
        for (let i = 0; i < path1.length - commonIndex; i++) {
            let next = path1[i].nextSibling;
            while (next !== undefined) {
                NodeUtils.nodeOrChildrenAppendToNodes(nodes, next);
                next = next.nextSibling;
            }
        }
    }

    static commonToPath2Nodes(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        let nextParent = path1.at(-commonIndex)?.nextSibling;
        while (nextParent) {
            if (nextParent === path2[0]) {
                nodes.push(path2[0]);
                return;
            }
            if (NodeUtils.isLinkedListNode(nextParent)) {
                if (NodeUtils.getNodesFromParentToChild(nodes, nextParent, path2[0])) {
                    return;
                }
            } else {
                nodes.push(nextParent);
            }
            nextParent = nextParent.nextSibling;
        }
    }

    public static nodeOrChildrenAppendToNodes(nodes: INode[], node: INode) {
        if (NodeUtils.isLinkedListNode(node)) {
            NodeUtils.getNodesFromParentToChild(nodes, node);
        } else {
            nodes.push(node);
        }
    }

    public static findTopLevelNodes(nodes: Set<INode>) {
        const result: INode[] = [];
        for (const node of nodes) {
            if (!NodeUtils.containsDescendant(nodes, node)) {
                result.push(node);
            }
        }
        return result;
    }

    static containsDescendant(nodes: Set<INode>, node: INode): boolean {
        if (node.parent === undefined) return false;
        if (nodes.has(node.parent)) return true;
        return NodeUtils.containsDescendant(nodes, node.parent);
    }

    private static getNodesFromParentToChild(
        nodes: INode[],
        parent: INodeLinkedList,
        until?: INode,
    ): boolean {
        nodes.push(parent);
        let node = parent.firstChild;
        while (node !== undefined) {
            if (until === node) {
                nodes.push(node);
                return true;
            }

            if (NodeUtils.isLinkedListNode(node)) {
                if (NodeUtils.getNodesFromParentToChild(nodes, node, until)) return true;
            } else {
                nodes.push(node);
            }
            node = node.nextSibling;
        }
        return false;
    }

    private static currentAtBack(preNode: INode, curNode: INode) {
        while (preNode.nextSibling !== undefined) {
            if (preNode.nextSibling === curNode) return true;
            preNode = preNode.nextSibling;
        }
        return false;
    }

    private static getCommonParentIndex(prePath: INode[], curPath: INode[]) {
        let index = 1;
        for (index; index <= Math.min(prePath.length, curPath.length); index++) {
            if (prePath.at(-index) !== curPath.at(-index)) break;
        }
        if (prePath.at(1 - index) !== curPath.at(1 - index)) throw new Error("can not find a common parent");
        return index;
    }

    private static getPathToRoot(node: INode): INode[] {
        const path: INode[] = [];
        let parent: INode | undefined = node;
        while (parent !== undefined) {
            path.push(parent);
            parent = parent.parent;
        }
        return path;
    }

    static findNode(parent: INodeLinkedList, predicate: (value: INode) => boolean) {
        function findNodeRecursive(
            node: INode | undefined,
            predicate: (value: INode) => boolean,
        ): INode | undefined {
            if (!node) {
                return undefined;
            }

            if (predicate(node)) {
                return node;
            }

            if (NodeUtils.isLinkedListNode(node)) {
                const found = findNodeRecursive(node.firstChild, predicate);
                if (found) {
                    return found;
                }
            }

            return findNodeRecursive(node.nextSibling, predicate);
        }

        return findNodeRecursive(parent.firstChild, predicate);
    }

    static findNodes(parent: INodeLinkedList, predicate?: (value: INode) => boolean) {
        function findNodesRecursive(
            result: INode[],
            node: INode | undefined,
            predicate?: (value: INode) => boolean,
        ) {
            if (!node) return;

            if (!predicate || predicate(node)) {
                result.push(node);
            }

            if (NodeUtils.isLinkedListNode(node)) {
                findNodesRecursive(result, node.firstChild, predicate);
            }

            if (node.nextSibling) {
                findNodesRecursive(result, node.nextSibling, predicate);
            }
        }

        const result: INode[] = [];
        findNodesRecursive(result, parent.firstChild, predicate);
        return result;
    }

    static serializeNode(node: INode) {
        const nodes: Serialized[] = [];
        NodeUtils.serializeNodeToArray(nodes, node, undefined);
        return nodes;
    }

    private static serializeNodeToArray(nodes: Serialized[], node: INode, parentId: string | undefined) {
        const serialized: any = Serializer.serializeObject(node);
        if (parentId) serialized["parentId"] = parentId;
        nodes.push(serialized);

        if (NodeUtils.isLinkedListNode(node) && node.firstChild) {
            NodeUtils.serializeNodeToArray(nodes, node.firstChild, node.id);
        }
        if (node.nextSibling) {
            NodeUtils.serializeNodeToArray(nodes, node.nextSibling, parentId);
        }
        return nodes;
    }

    public static async deserializeNode(document: IDocument, nodes: Serialized[]) {
        const nodeMap: Map<string, INodeLinkedList> = new Map();
        nodes.forEach((n) => {
            const node = Serializer.deserializeObject(document, n);
            if (NodeUtils.isLinkedListNode(node)) {
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
