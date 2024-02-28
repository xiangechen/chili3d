// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication, IDocument, IEventHandler, INode, IService, Lazy, Logger, PubSub } from "chili-core";
import { EditorEventHandler } from "../editor";

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
        if (document.application.executingCommand) return;
        if (selected.length > 0) {
            this.handler = new EditorEventHandler(document, selected);
            document.visual.eventHandler = this.handler;
        } else {
            document.visual.resetEventHandler();
        }
    };
}
