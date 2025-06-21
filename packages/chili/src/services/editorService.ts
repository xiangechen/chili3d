// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
        Logger.info(`${EditorService.name} stopped`);
    }

    private readonly handleSelectionChanged = (document: IDocument, selected: INode[]) => {
        this.editHandler?.dispose();
        this.editHandler = undefined;

        if (document.application.executingCommand) return;

        if (selected.length > 0) {
            this.editHandler = this.factory(document, selected);
            document.visual.eventHandler = this.editHandler;
        } else {
            document.visual.resetEventHandler();
        }
    };
}
