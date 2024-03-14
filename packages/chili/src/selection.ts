// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CursorType,
    I18nKeys,
    IDisposable,
    IDocument,
    IEventHandler,
    INode,
    ISelection,
    IShapeFilter,
    Logger,
    PubSub,
    ShapeType,
    VisualState,
} from "chili-core";
import { ModelSelectionHandler, ShapeSelectionHandler } from "chili-vis";

export class Selection implements ISelection, IDisposable {
    private _selectedNodes: INode[] = [];
    private _unselectedNodes: INode[] = [];

    shapeType: ShapeType = ShapeType.Shape;
    nodeType: "model" | "node" = "node";
    filter?: IShapeFilter;

    constructor(readonly document: IDocument) {}

    async pickShape(prompt: I18nKeys, controller: AsyncController, multiMode: boolean) {
        let handler = new ShapeSelectionHandler(
            this.document,
            this.shapeType,
            multiMode,
            controller,
            this.filter,
        );
        await this.pickAsync(handler, prompt, controller, multiMode === true);
        let shapes = handler.shapes();
        handler.dispose();
        return shapes;
    }

    async pickModel(prompt: I18nKeys, controller: AsyncController, multiMode: boolean) {
        let oldNodeType = this.nodeType;
        try {
            this.nodeType = "model";
            let handler = new ModelSelectionHandler(this.document, multiMode, controller, this.filter);
            await this.pickAsync(handler, prompt, controller, multiMode === true);
            let models = handler.models();
            handler.dispose();
            return models;
        } finally {
            this.nodeType = oldNodeType;
        }
    }

    async pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType = "select.default",
    ) {
        let oldHandler = this.document.visual.eventHandler;
        this.document.visual.eventHandler = handler;
        PubSub.default.pub("viewCursor", cursor);
        PubSub.default.pub("statusBarTip", prompt);
        if (showControl) PubSub.default.pub("showSelectionControl", controller);
        await new Promise((resolve, reject) => {
            controller.onCompleted(resolve);
            controller.onCancelled(reject);
        })
            .catch((e) => Logger.warn("pick status: ", e))
            .finally(() => {
                if (showControl) PubSub.default.pub("clearSelectionControl");
                PubSub.default.pub("clearStatusBarTip");
                this.document.visual.eventHandler = oldHandler;
                PubSub.default.pub("viewCursor", "default");
            });
    }

    dispose(): void {
        this._selectedNodes.length = 0;
        this._unselectedNodes.length = 0;
    }

    getSelectedNodes(): INode[] {
        return this._selectedNodes;
    }

    setSelection(nodes: INode[], toggle: boolean) {
        nodes = this.nodeType === "node" ? nodes : nodes.filter(this.nodeFilter);
        if (toggle) {
            this.toggleSelectPublish(nodes, true);
        } else {
            this.removeSelectedPublish(this._selectedNodes, false);
            this.addSelectPublish(nodes, true);
        }
        return this._selectedNodes.length;
    }

    private nodeFilter = (x: INode) => {
        if (INode.isModelNode(x)) {
            let shape = x.shape();
            if (!shape || !this.filter) return true;
            return this.filter.allow(shape);
        }
        return false;
    };

    deselect(nodes: INode[]) {
        this.removeSelectedPublish(nodes, true);
    }

    clearSelection() {
        this.removeSelectedPublish(this._selectedNodes, true);
    }

    private updateSelection() {
        this.document.visual.viewer.update();
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
                this.document.visual.context.getShape(m)?.addState(VisualState.selected, ShapeType.Shape);
            }
        });
        this._selectedNodes.push(...nodes);
        if (publish) this.updateSelection();
    }

    private removeSelectedPublish(nodes: INode[], publish: boolean) {
        for (const node of nodes) {
            if (INode.isModelNode(node)) {
                this.document.visual.context
                    .getShape(node)
                    ?.removeState(VisualState.selected, ShapeType.Shape);
            }
        }
        this._selectedNodes = this._selectedNodes.filter((m) => !nodes.includes(m));
        this._unselectedNodes = nodes;
        if (publish) this.updateSelection();
    }
}
