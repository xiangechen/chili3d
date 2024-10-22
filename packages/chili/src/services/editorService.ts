// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication, IDocument, IEventHandler, INode, IService, Logger, PubSub } from "chili-core";

export class EditorService implements IService {
    private editHandler?: IEventHandler;

    constructor(readonly factory: (document: IDocument, selected: INode[]) => IEventHandler) {}

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

    private readonly handleSelectionChanged = (document: IDocument, selected: INode[]) => {
        if (this.editHandler !== undefined) {
            this.editHandler.dispose();
            this.editHandler = undefined;
        }
        if (document.application.executingCommand) return;
        if (selected.length > 0) {
            this.editHandler = this.factory(document, selected);
            document.visual.eventHandler = this.editHandler;
        } else {
            document.visual.resetEventHandler();
        }
    };
}
