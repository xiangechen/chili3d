// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub, Model, Logger } from "chili-core";
import { Application } from "../application";
import { CircleBody, LineBody } from "../bodys";
import { EditorEventHandler, LineEditorEventHandler } from "../editors";
import { CircleEditorEventHandler } from "../editors/circleEditor";
import { IApplicationService } from "./applicationService";

export class EditorService implements IApplicationService {
    private static _instance: EditorService | undefined;

    public static get instance() {
        if (EditorService._instance === undefined) {
            EditorService._instance = new EditorService();
        }
        return EditorService._instance;
    }

    private handler?: EditorEventHandler;

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

    private handleSelectionChanged = (document: IDocument, models: Model[]) => {
        if (this.handler !== undefined) {
            this.handler.dispose();
            this.handler = undefined;
        }
        if (models.length > 0) {
            this.handler = this.getEventHandler(document, models);
            if (this.handler !== undefined) {
                document.visualization.eventHandler = this.handler;
            }
        } else {
            document.visualization.clearEventHandler();
        }
        document.viewer.redraw();
    };

    private getEventHandler(document: IDocument, models: Model[]): EditorEventHandler | undefined {
        if (models.length > 1) return undefined;
        if (Model.isGeometry(models[0])) {
            let body = models[0].body;
            if (body instanceof LineBody) {
                return new LineEditorEventHandler(document, body);
            } else if (body instanceof CircleBody) {
                return new CircleEditorEventHandler(document, body);
            }
        }
        return undefined;
    }
}
