// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication, IDocument, IEventHandler, INode, IService, Lazy, Logger, PubSub } from "chili-core";
import { DefaultEditorEventHandler } from "../editors";

export class EditorService implements IService {
    private static readonly _lazy = new Lazy(() => new EditorService());

    static get instance() {
        return this._lazy.value;
    }

    private handler?: IEventHandler;

    register(_app: IApplication): void {
        Logger.info(`${EditorService.name} registed`);
    }

    start(): void {
        PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
        Logger.info(`${EditorService.name} started`);
    }

    stop(): void {
        PubSub.default.remove("selectionChanged", this.handleSelectionChanged);
        Logger.info(`${EditorService.name} stoped`);
    }

    private handleSelectionChanged = (document: IDocument, selected: INode[], deselected: INode[]) => {
        if (this.handler !== undefined) {
            this.handler.dispose();
            this.handler = undefined;
        }
        if (selected.length > 0) {
            this.handler = this.getEventHandler(document, selected, deselected);
            if (this.handler !== undefined) {
                document.visual.eventHandler = this.handler;
            }
        } else {
            document.visual.resetEventHandler();
        }
        document.visual.viewer.update();
    };

    private getEventHandler(
        document: IDocument,
        selected: INode[],
        deselected: INode[],
    ): IEventHandler | undefined {
        if (selected.length === 1 && INode.isModelNode(selected[0])) {
            let body = selected[0].body;
            // if (body instanceof LineBody) {
            //     return new LineEditorEventHandler(document, body);
            // } else if (body instanceof CircleBody) {
            //     return new CircleEditorEventHandler(document, body);
            // }
        }
        return new DefaultEditorEventHandler(document, selected);
    }
}
