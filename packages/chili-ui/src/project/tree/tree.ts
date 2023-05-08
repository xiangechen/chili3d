// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub, INode, NodeRecord, Transaction } from "chili-core";
import style from "./tree.module.css";
import { TreeModel } from "./treeModel";
import { TreeItem } from "./treeItem";
import { TreeGroup } from "./treeItemGroup";
import { Control } from "../../components";

export class Tree extends Control {
    private readonly nodeMap = new WeakMap<INode, TreeItem>();
    private lastClicked: INode | undefined;
    private readonly selectedNodes: Set<INode> = new Set();
    private dragging: INode[] | undefined;

    constructor(readonly document: IDocument) {
        super(style.panel);
        let e = this.createHTMLElement(document, document.rootNode);
        this.nodeMap.set(document.rootNode, e);
        this.append(e);
        PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
        PubSub.default.sub("nodeLinkedListChanged", this.handleNodeLinkedChanged);
        PubSub.default.sub("nodeAdded", this.handleNodeAdded);
        PubSub.default.sub("nodeRemoved", this.handleNodeRemoved);
    }

    private handleNodeAdded = (source: IDocument, nodes: INode[]) => {
        nodes.forEach((node) => this.nodeMap.set(node, this.createHTMLElement(source, node)));
    };

    private handleNodeRemoved = (source: IDocument, nodes: INode[]) => {
        nodes.forEach((node) => this.nodeMap.delete(node));
    };

    private handleNodeLinkedChanged = (records: NodeRecord[]) => {
        for (const record of records) {
            let ele = this.nodeMap.get(record.node);
            if (ele === undefined) continue;

            if (record.oldParent !== undefined) {
                this.nodeMap.get(record.oldParent)?.removeChild(ele);
            }
            if (record.newParent !== undefined) {
                let parent = this.nodeMap.get(record.newParent);
                if (parent !== undefined && parent instanceof TreeGroup) {
                    let pre = record.newPrevious === undefined ? null : this.nodeMap.get(record.newPrevious);
                    parent.insertAfter(ele, pre ?? null);
                }
            }
        }
    };

    private handleSelectionChanged = (document: IDocument, selected: INode[], unselected: INode[]) => {
        unselected.forEach((x) => {
            this.nodeMap.get(x)?.removeSelectedStyle(style.selected);
            this.selectedNodes.delete(x);
        });
        this.setLastClickItem(undefined);
        selected.forEach((model) => {
            this.selectedNodes.add(model);
            this.nodeMap.get(model)?.addSelectedStyle(style.selected);
        });
        this.scrollToNode(selected);
    };

    private scrollToNode(selected: INode[]) {
        let node = selected.at(0);
        if (node !== undefined) {
            let parent = node.parent;
            while (parent) {
                const group = this.nodeMap.get(parent) as TreeGroup;
                if (group !== undefined) {
                    if (group.isExpanded === false) {
                        group.isExpanded = true;
                    }
                    parent = parent.parent;
                }
            }
            this.nodeMap.get(node)?.scrollIntoView({ block: "nearest" });
        }
    }

    private createHTMLElement(document: IDocument, node: INode): TreeItem {
        let result: TreeItem;
        if (INode.isCollectionNode(node)) result = new TreeGroup(document, node);
        else if (INode.isModelNode(node)) result = new TreeModel(node);
        else throw "unknown node";

        result.onConnectedCallback(() => this.addEvents(result));
        result.onDisconnectedCallback(() => this.removeEvents(result));

        return result;
    }

    private addEvents(item: HTMLElement) {
        item.addEventListener("dragstart", this.onDragStart);
        item.addEventListener("dragover", this.onDragOver);
        item.addEventListener("dragleave", this.onDragLeave);
        item.addEventListener("drop", this.onDrop);
        item.addEventListener("click", this.onClick);
    }

    private removeEvents(item: HTMLElement) {
        item.removeEventListener("dragstart", this.onDragStart);
        item.removeEventListener("dragover", this.onDragOver);
        item.removeEventListener("dragleave", this.onDragLeave);
        item.removeEventListener("drop", this.onDrop);
        item.removeEventListener("click", this.onClick);
    }

    private getTreeItem(item: HTMLElement | null): TreeItem | undefined {
        if (item === null) return undefined;
        if (item instanceof TreeItem) return item;
        return this.getTreeItem(item.parentElement);
    }

    private onClick = (event: MouseEvent) => {
        let item = this.getTreeItem(event.target as HTMLElement)?.node;
        if (item === undefined) return;
        event.stopPropagation();

        if (event.shiftKey) {
            if (this.lastClicked !== undefined) {
                let nodes = INode.getNodesBetween(this.lastClicked, item);
                this.document.visual.selection.setSelected(false, nodes);
            }
        } else {
            this.document.visual.selection.setSelected(event.ctrlKey, [item]);
        }

        this.setLastClickItem(item);
    };

    private onDragLeave = (event: DragEvent) => {
        if (!this.canDrop(event)) return;
    };

    private onDragOver = (event: DragEvent) => {
        if (!this.canDrop(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer!.dropEffect = "move";
    };

    private setLastClickItem(item: INode | undefined) {
        if (this.lastClicked !== undefined) {
            this.nodeMap.get(this.lastClicked)?.removeSelectedStyle(style.current);
        }
        this.lastClicked = item;
        if (item !== undefined) {
            this.nodeMap.get(item)?.addSelectedStyle(style.current);
            this.document.currentNode = item;
        }
    }

    private canDrop(event: DragEvent) {
        let node = this.getTreeItem(event.target as HTMLElement)?.node;
        if (node === undefined) return false;
        if (this.dragging?.includes(node)) return false;
        let parent = node.parent;
        while (parent !== undefined) {
            if (this.dragging?.includes(parent)) return false;
            parent = parent.parent;
        }
        return true;
    }

    protected onDrop = (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();

        let node = this.getTreeItem(event.target as HTMLElement)?.node;
        if (node === undefined) return;
        let group = INode.isCollectionNode(node) ? node : node.parent;
        if (group !== undefined) {
            Transaction.excute(this.document, "move node", () => {
                this.dragging?.forEach((x) => {
                    x.parent?.moveToAfter(x, group!);
                });
            });
        }

        this.dragging = undefined;
    };

    private onDragStart = (event: DragEvent) => {
        event.stopPropagation();
        let item = this.getTreeItem(event.target as HTMLElement)?.node;
        this.dragging = this.findAllCommonParents();
        if (item !== undefined && !this.selectedNodes.has(item)) {
            this.dragging.push(item);
        }
    };

    private findAllCommonParents() {
        let result: INode[] = [];
        for (const node of this.selectedNodes) {
            if (node.parent === undefined || !this.selectedNodes.has(node.parent)) {
                result.push(node);
            }
        }
        return result;
    }
}

customElements.define("ui-tree", Tree);
