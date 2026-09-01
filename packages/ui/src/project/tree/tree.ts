// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Annotation,
    FolderNode,
    type IDocument,
    type INode,
    type INodeLinkedList,
    type ModelManager,
    type NodeRecord,
    NodeSelectionHandler,
    NodeUtils,
    PubSub,
    ShapeSelectionHandler,
    ShapeTypes,
    Transaction,
    VisualNode,
} from "@chili3d/core";
import style from "./tree.module.css";
import { TreeItem } from "./treeItem";
import { TreeGroup } from "./treeItemGroup";
import { TreeModel } from "./treeModel";

export class Tree extends HTMLElement {
    private readonly nodeMap = new Map<INode, TreeItem>();
    private readonly selectedNodes: Set<INode> = new Set();
    private dragging: INode[] | undefined;
    private highlightedGroup: TreeGroup | undefined;
    private lastClicked: INode | undefined;
    private lastSelected: INode[] | undefined;

    constructor(private document: IDocument) {
        super();
        this.className = style.panel;
        this.initializeTree(document);
    }

    private initializeTree(document: IDocument) {
        this.addAllNodes(document, this, document.modelManager.rootNode);
        this.addEvents(this);
    }

    connectedCallback() {
        this.document.modelManager.addNodeObserver(this.handleNodeChanged);
        this.document.modelManager.onPropertyChanged(this.handleCurrentNodeChanged);
        this.document.selection.onNodeChanged.sub(this.handleSelectionChanged);
    }

    disconnectedCallback() {
        this.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.document.modelManager.removePropertyChanged(this.handleCurrentNodeChanged);
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
    }

    private readonly handleCurrentNodeChanged = (
        prop: keyof ModelManager,
        source: ModelManager,
        oldValue: any,
    ) => {
        if (prop === "currentNode") {
            if (oldValue !== undefined) {
                this.nodeMap.get(oldValue)?.removeStyle(style.current);
            }
            if (source.currentNode) {
                this.nodeMap.get(source.currentNode)?.addStyle(style.current);
            }
        }
    };

    treeItem(node: INode): TreeItem | undefined {
        return this.nodeMap.get(node);
    }

    dispose(): void {
        this.lastClicked = undefined;
        this.dragging = undefined;
        this.highlightedGroup = undefined;
        this.nodeMap.forEach((x) => x.dispose());
        this.nodeMap.clear();
        this.selectedNodes.clear();
        this.removeEvents(this);
        this.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.document.modelManager.removePropertyChanged(this.handleCurrentNodeChanged);
        this.document.selection.onNodeChanged.remove(this.handleSelectionChanged);
        this.document = null as any;
    }

    readonly handleNodeChanged = (records: NodeRecord[]) => {
        this.ensureHasHTML(records);
        records.forEach((record) => {
            const ele = this.nodeMap.get(record.node);
            ele?.remove();
            if (!ele || !record.newParent) {
                this.refreshGroupExpander(record.oldParent);
                // A removed node may be a sketch referenced by a body — drop its mirror rows.
                if (!record.newParent) this.refreshReferenceRows();
                return;
            }

            const parent = this.nodeMap.get(record.newParent) || this.createAndMapParent(record.newParent);
            if (parent instanceof TreeGroup) {
                const pre = record.newPrevious ? this.nodeMap.get(record.newPrevious) : null;
                parent.insertAfter(ele, pre ?? null);
                parent.refreshExpander();
            }
            ele.refreshVisibleIcon();
            this.refreshGroupExpander(record.oldParent);
        });
    };

    private refreshGroupExpander(parent: INodeLinkedList | undefined) {
        const group = parent === undefined ? undefined : this.nodeMap.get(parent);
        if (group instanceof TreeGroup) group.refreshExpander();
    }

    private refreshReferenceRows() {
        this.nodeMap.forEach((item) => {
            if (item instanceof TreeGroup) item.refreshReferences();
        });
    }

    private createAndMapParent(newParent: INode) {
        const parent = this.createHTMLElement(this.document, newParent);
        this.nodeMap.set(newParent, parent);
        return parent;
    }

    private readonly handleSelectionChanged = (selected: INode[]) => {
        this.lastSelected?.forEach((x) => {
            this.nodeMap.get(x)?.removeStyle(style.selected);
            this.selectedNodes.delete(x);
        });
        this.lastSelected = Array.from(selected);

        selected.forEach((model) => {
            this.selectedNodes.add(model);
            this.nodeMap.get(model)?.addStyle(style.selected);
        });
        this.scrollToNode(selected);
    };

    private ensureHasHTML(records: NodeRecord[]) {
        records.forEach((record) => {
            if (!this.nodeMap.has(record.node)) {
                this.nodeMap.set(record.node, this.createHTMLElement(this.document, record.node));
            }
        });
    }

    private scrollToNode(selected: INode[]) {
        const node = selected.at(0);
        if (node) {
            this.expandParents(node);
            this.nodeMap.get(node)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }

    private expandParents(node: INode) {
        let parent = node.parent;
        while (parent) {
            const group = this.nodeMap.get(parent) as TreeGroup;
            if (group && !group.isExpanded) {
                group.isExpanded = true;
            }
            parent = parent.parent;
        }
    }

    private addAllNodes(document: IDocument, parent: HTMLElement, node: INode) {
        const element = this.createHTMLElement(document, node);
        this.nodeMap.set(node, element);
        parent.appendChild(element);

        const firstChild = (node as INodeLinkedList).firstChild;
        if (firstChild) this.addAllNodes(document, element, firstChild);
        if (node.nextSibling) this.addAllNodes(document, parent, node.nextSibling);
    }

    private createHTMLElement(document: IDocument, node: INode): TreeItem {
        let result: TreeItem;
        if (NodeUtils.isLinkedListNode(node)) result = new TreeGroup(document, node);
        else if (node instanceof VisualNode || node instanceof Annotation)
            result = new TreeModel(document, node);
        else throw new Error("unknown node");
        return result;
    }

    private addEvents(item: HTMLElement) {
        item.addEventListener("dragstart", this.onDragStart);
        item.addEventListener("dragover", this.onDragOver);
        item.addEventListener("dragleave", this.onDragLeave);
        item.addEventListener("dragend", this.onDragEnd);
        item.addEventListener("drop", this.onDrop);
        item.addEventListener("click", this.onClick);
        item.addEventListener("dblclick", this.onDoubleClick);
    }

    private removeEvents(item: HTMLElement) {
        item.removeEventListener("dragstart", this.onDragStart);
        item.removeEventListener("dragover", this.onDragOver);
        item.removeEventListener("dragleave", this.onDragLeave);
        item.removeEventListener("dragend", this.onDragEnd);
        item.removeEventListener("drop", this.onDrop);
        item.removeEventListener("click", this.onClick);
        item.removeEventListener("dblclick", this.onDoubleClick);
    }

    private getTreeItem(item: HTMLElement | null): TreeItem | undefined {
        if (item === null) return undefined;
        if (item instanceof TreeItem) return item;
        return this.getTreeItem(item.parentElement);
    }

    private readonly onClick = (event: MouseEvent) => {
        if (!this.canSelect()) return;

        const item = this.getTreeItem(event.target as HTMLElement)?.node;
        if (!item) return;
        event.stopPropagation();

        if (event.shiftKey) {
            this.handleShiftClick(item);
        } else {
            this.document.selection.setSelectedNodes([item], event.ctrlKey);
        }

        this.handleLastClickItem(item);
    };

    /** Lets feature packages react to a node double-click (e.g. sketch editing). */
    private readonly onDoubleClick = (event: MouseEvent) => {
        const node = this.getTreeItem(event.target as HTMLElement)?.node;
        if (node === undefined) return;
        event.stopPropagation();
        PubSub.default.pub("nodeDoubleClicked", node);
    };

    private handleShiftClick(item: INode) {
        if (this.lastClicked) {
            const nodes = NodeUtils.getNodesBetween(this.lastClicked, item);
            this.document.selection.setSelectedNodes(nodes, false);
        }
    }

    private readonly onDragLeave = (event: DragEvent) => {
        if (event.target === this) {
            this.clearDropTargetHighlight();
        }
    };

    private readonly onDragOver = (event: DragEvent) => {
        if (!this.canDrop(event)) {
            this.clearDropTargetHighlight();
            return;
        }
        event.preventDefault();
        event.dataTransfer!.dropEffect = "move";

        const group = this.getDropTargetGroup(event.target as HTMLElement);
        if (group !== this.highlightedGroup) {
            this.clearDropTargetHighlight();
            if (group) {
                this.highlightedGroup = group;
                group.classList.add(style.dropTarget);
            }
        }
    };

    private canSelect() {
        if (this.document.visual.eventHandler instanceof NodeSelectionHandler) {
            return true;
        }

        if (this.document.visual.eventHandler instanceof ShapeSelectionHandler) {
            return this.document.visual.eventHandler.shapeType === ShapeTypes.shape;
        }

        return false;
    }

    private handleLastClickItem(item: INode | undefined) {
        this.lastClicked = item;
        if (item !== undefined) {
            // Only folders accept new nodes: a parametric body is a linked list too,
            // but its children are consumed boolean tools hidden from the scene.
            // Walk up to the nearest folder ancestor when clicking inside such a body.
            let node: INodeLinkedList | undefined = item instanceof FolderNode ? item : item.parent;
            while (node !== undefined && !(node instanceof FolderNode)) {
                node = node.parent;
            }
            this.document.modelManager.currentNode = node;
        }
    }

    private canDrop(event: DragEvent) {
        const node = this.getTreeItem(event.target as HTMLElement)?.node;
        return node !== undefined && this.canDropNode(node);
    }

    private canDropNode(node: INode) {
        if (this.dragging?.includes(node)) return false;
        // Rows under a parametric body (consumed tools) accept no drops.
        if (node.parent !== undefined && !(node.parent instanceof FolderNode)) return false;
        let parent: INodeLinkedList | undefined = node.parent;
        while (parent !== undefined) {
            if (this.dragging?.includes(parent)) return false;
            parent = parent.parent;
        }
        return true;
    }

    protected onDrop = (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.clearDropTargetHighlight();

        const node = this.getTreeItem(event.target as HTMLElement)?.node;
        if (node === undefined || !this.canDropNode(node)) return;
        Transaction.execute(this.document, "move node", () => {
            // Drop INTO folders only — dropping onto a parametric body (also a linked
            // list, holding hidden consumed tools) inserts as its sibling instead.
            const isFolder = node instanceof FolderNode;
            const newParent = isFolder ? (node as INodeLinkedList) : node.parent;
            if (!(newParent instanceof FolderNode)) return; // never drop into a body
            const target = isFolder ? undefined : node;
            this.dragging?.forEach((x) => {
                x.parent?.move(x, newParent, target);
            });
            this.dragging = undefined;
        });
    };

    private readonly onDragStart = (event: DragEvent) => {
        event.stopPropagation();
        const item = this.getTreeItem(event.target as HTMLElement)?.node;
        // Consumed boolean tools (children of a parametric body) stay with the body.
        const draggable = (x: INode) => x.parent === undefined || x.parent instanceof FolderNode;
        this.dragging = NodeUtils.findTopLevelNodes(this.selectedNodes).filter(draggable);
        if (
            item &&
            draggable(item) &&
            !this.dragging.includes(item) &&
            !NodeUtils.containsDescendant(this.selectedNodes, item)
        ) {
            this.dragging.push(item);
        }
    };

    private readonly onDragEnd = () => {
        this.clearDropTargetHighlight();
        this.dragging = undefined;
    };

    private getDropTargetGroup(element: HTMLElement): TreeGroup | undefined {
        // Folders only — a parametric body's TreeGroup holds hidden consumed tools
        // and is not a drop target (the drop lands next to the body instead).
        let current: HTMLElement | null = this.getTreeItem(element) ?? null;
        while (current) {
            if (current instanceof TreeGroup && current.node instanceof FolderNode) return current;
            current = current.parentElement;
        }
        return undefined;
    }

    private clearDropTargetHighlight() {
        if (this.highlightedGroup) {
            this.highlightedGroup.classList.remove(style.dropTarget);
            this.highlightedGroup = undefined;
        }
    }
}

customElements.define("ui-tree", Tree);
