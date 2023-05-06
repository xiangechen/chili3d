// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, INode, ISelection, IVisualizationContext, Observable, PubSub } from "chili-core";

export class Selection extends Observable implements ISelection {
    private _selectedNodes: INode[] = [];
    private _unselectedNodes: INode[] = [];

    constructor(readonly document: IDocument, readonly context: IVisualizationContext) {
        super();
    }

    getSelectedNodes(): INode[] {
        return this._selectedNodes;
    }

    setSelected(toggle: boolean, nodes: INode[]) {
        if (toggle) {
            this.toggleSelectPublish(nodes, true);
        } else {
            this.removeSelectedPublish(this._selectedNodes, false);
            this.addSelectPublish(nodes, true);
        }
    }

    unSelected(nodes: INode[]) {
        this.removeSelectedPublish(nodes, true);
    }

    clearSelected() {
        this.removeSelectedPublish(this._selectedNodes, true);
    }

    private publishSelection() {
        PubSub.default.pub("selectionChanged", this.document, this._selectedNodes, this._unselectedNodes);
    }

    private toggleSelectPublish(nodes: INode[], publish: boolean) {
        let selected = nodes.filter((m) => this._selectedNodes.includes(m));
        let unSelected = nodes.filter((m) => !this._selectedNodes.includes(m));
        this.removeSelectedPublish(selected, false);
        this.addSelectPublish(unSelected, publish);
    }

    private addSelectPublish(nodes: INode[], publish: boolean) {
        nodes.forEach((m) => {
            if (INode.isModelNode(m)) {
                this.context.getShape(m)?.selectedState();
            }
        });
        this._selectedNodes.push(...nodes);
        if (publish) this.publishSelection();
    }

    private removeSelectedPublish(nodes: INode[], publish: boolean) {
        for (const node of nodes) {
            if (INode.isModelNode(node)) {
                this.context.getShape(node)?.unSelectedState();
            }
        }
        this._selectedNodes = this._selectedNodes.filter((m) => !nodes.includes(m));
        this._unselectedNodes = nodes;
        if (publish) this.publishSelection();
    }
}
