// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub, ModelObject, Logger } from "chili-core";
import { Application } from "../application";
import { IApplicationService } from "./applicationService";

export class EditorService implements IApplicationService {
    private static _instance: EditorService | undefined;

    public static get instance() {
        if (EditorService._instance === undefined) {
            EditorService._instance = new EditorService();
        }
        return EditorService._instance;
    }

    register(_app: Application): void {
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

    private handleSelectionChanged = (document: IDocument, models: ModelObject[]) => {};
}
