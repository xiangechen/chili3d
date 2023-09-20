// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, HistoryObservable, IDisposable, IPropertyChanged } from "../base";
import { IDocument } from "../document";
import { IShape } from "../geometry";
import { Id } from "../id";
import { Matrix4 } from "../math";
import { Property } from "../property";
import { ISerialize, Serializer } from "../serialize";
import { Entity } from "./entity";

export interface INode extends IPropertyChanged, ISerialize, IDisposable {
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
    size(): number;
    insertAfter(target: INode | undefined, node: INode): void;
    insertBefore(target: INode | undefined, node: INode): void;
    move(child: INode, newParent: this, newPreviousSibling?: INode): void;
}

export interface IModel extends INode {
    readonly document: IDocument;
    readonly body: Entity;
    matrix: Matrix4;
    color: Color;
    shape(): IShape | undefined;
}

export interface IModelGroup extends IModel {
    children: ReadonlyArray<IModel>;
}

export namespace INode {
    export function isLinkedListNode(node: INode): node is INodeLinkedList {
        return (node as INodeLinkedList).add !== undefined;
    }

    export function isModelNode(node: INode): node is IModel {
        return (node as IModel).matrix !== undefined;
    }

    export function isModelGroup(node: INode): node is IModelGroup {
        let group = node as IModelGroup;
        return group.matrix !== undefined && group.children !== undefined;
    }
}

export abstract class Node extends HistoryObservable implements INode {
    private _visible: boolean = true;
    private _parentVisible: boolean = true;

    parent: INodeLinkedList | undefined;
    previousSibling: INode | undefined;

    @Serializer.property()
    nextSibling: INode | undefined;

    @Serializer.property()
    readonly id: string;

    constructor(
        document: IDocument,
        private _name: string,
        id: string = Id.new(),
    ) {
        super(document);
        this.id = id;
    }

    @Serializer.property()
    @Property.define("common.name")
    get name() {
        return this._name;
    }

    set name(value: string) {
        this.setProperty("name", value);
    }

    @Serializer.property()
    get visible(): boolean {
        return this._visible;
    }

    set visible(value: boolean) {
        this.setProperty("visible", value, () => this.onVisibleChanged());
    }

    protected abstract onVisibleChanged(): void;

    get parentVisible() {
        return this._parentVisible;
    }

    set parentVisible(value: boolean) {
        this.setProperty("parentVisible", value, () => this.onParentVisibleChanged());
    }

    clone(): this {
        let serialized = Serializer.serialize(this);
        serialized.properties["id"] = Id.new();
        serialized.properties["name"] = `${this._name}_copy`;
        serialized.properties["parent"] = this.parent;
        return Serializer.deserialize(this.document, serialized);
    }

    protected abstract onParentVisibleChanged(): void;
}

export namespace INode {
    export function getNodesBetween(node1: INode, node2: INode): INode[] {
        if (node1 === node2) return [node1];
        let nodes: INode[] = [];
        let prePath = getPathToRoot(node1);
        let curPath = getPathToRoot(node2);
        let index = getCommonParentIndex(prePath, curPath);
        let parent = prePath.at(1 - index) as INodeLinkedList;
        if (parent === curPath[0] || parent === prePath[0]) {
            let child = parent === curPath[0] ? prePath[0] : curPath[0];
            getNodesFromParentToChild(nodes, parent, child);
        } else {
            if (currentAtBack(prePath.at(-index)!, curPath.at(-index)!)) {
                getNodesFromPath(nodes, prePath, curPath, index);
            } else {
                getNodesFromPath(nodes, curPath, prePath, index);
            }
        }
        return nodes;
    }

    function getNodesFromPath(nodes: INode[], path1: INode[], path2: INode[], commonIndex: number) {
        addNodeOrChildrenToNodes(nodes, path1[0]);
        for (let i = 0; i < path1.length - commonIndex; i++) {
            let next = path1[i].nextSibling;
            while (next !== undefined) {
                addNodeOrChildrenToNodes(nodes, next);
                next = next.nextSibling;
            }
        }

        let nextParent = path1.at(-commonIndex)?.nextSibling;
        while (nextParent !== undefined) {
            if (nextParent === path2[0]) {
                nodes.push(path2[0]);
                return;
            }
            if (INode.isLinkedListNode(nextParent)) {
                if (getNodesFromParentToChild(nodes, nextParent, path2[0])) {
                    return;
                }
            } else nodes.push(nextParent);
            nextParent = nextParent.nextSibling;
        }
    }

    export function addNodeOrChildrenToNodes(nodes: INode[], node: INode) {
        if (INode.isLinkedListNode(node)) {
            getNodesFromParentToChild(nodes, node);
        } else {
            nodes.push(node);
        }
    }

    export function findTopLevelNodes(nodes: Set<INode>) {
        let result: INode[] = [];
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
        let path: INode[] = [];
        let parent: INode | undefined = node;
        while (parent !== undefined) {
            path.push(parent);
            parent = parent.parent;
        }
        return path;
    }
}
