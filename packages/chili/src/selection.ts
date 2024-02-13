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

    constructor(readonly document: IDocument) {}

    async pickShape(
        shapeType: ShapeType,
        prompt: I18nKeys,
        controller: AsyncController,
        multiMode: boolean,
        filter?: IShapeFilter,
    ) {
        let handler = new ShapeSelectionHandler(this.document, shapeType, multiMode, controller, filter);
        await this.pickAsync(handler, prompt, controller, multiMode === true);
        let shapes = handler.shapes();
        handler.dispose();
        return shapes;
    }

    async pickModel(
        prompt: I18nKeys,
        controller: AsyncController,
        multiMode: boolean,
        filter?: IShapeFilter,
    ) {
        let handler = new ModelSelectionHandler(this.document, multiMode, true, controller, filter);
        await this.pickAsync(handler, prompt, controller, multiMode === true);
        let models = handler.models();
        handler.dispose();
        return models;
    }

    async pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType = CursorType.Selection,
    ) {
        let oldHandler = this.document.visual.eventHandler;
        this.document.visual.eventHandler = handler;
        this.document.visual.viewer.setCursor(cursor);
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
                this.document.visual.viewer.setCursor(CursorType.Default);
            });
    }

    dispose(): void {
        this._selectedNodes.length = 0;
        this._unselectedNodes.length = 0;
    }

    getSelectedNodes(): INode[] {
        return this._selectedNodes;
    }

    select(nodes: INode[], toggle: boolean) {
        if (toggle) {
            this.toggleSelectPublish(nodes, true);
        } else {
            this.removeSelectedPublish(this._selectedNodes, false);
            this.addSelectPublish(nodes, true);
        }
        return this._selectedNodes.length;
    }

    deselect(nodes: INode[]) {
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
                this.document.visual.context.getShape(m)?.addState(VisualState.selected, ShapeType.Shape);
            }
        });
        this._selectedNodes.push(...nodes);
        if (publish) this.publishSelection();
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
        if (publish) this.publishSelection();
    }
}
