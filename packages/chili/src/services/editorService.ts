// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    PubSub,
    ModelObject,
    Logger,
    IView,
    Validation,
    XYZ,
    I18n,
    IEventHandler,
    IDisposable,
    VertexRenderData,
} from "chili-core";
import { Application } from "../application";
import { LineBody } from "../bodys";
import { SnapEventHandler } from "../snap";
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

    private handleSelectionChanged = (document: IDocument, models: ModelObject[]) => {
        if (this.handler !== undefined) {
            this.handler.dispose();
            this.handler = undefined;
        }
        if (models.length > 0) {
            this.handler = new EditorEventHandler(document, models);
            document.visualization.eventHandler = this.handler;
        } else {
            document.visualization.clearEventHandler();
        }
    };
}

export class EditorEventHandler implements IEventHandler, IDisposable {
    private editorPoints: number[] = [];

    constructor(readonly document: IDocument, readonly models: ModelObject[]) {
        this.showEditorPoints();
    }

    private showEditorPoints() {
        if (this.models.length === 1 && ModelObject.isModel(this.models[0])) {
            let body = this.models[0].body as LineBody;
            let start = VertexRenderData.from(body.start, 0xffff00, 5);
            let end = VertexRenderData.from(body.end, 0xffff00, 5);
            let startId = this.document.visualization.context.temporaryDisplay(start);
            let endId = this.document.visualization.context.temporaryDisplay(end);
            this.editorPoints.push(startId, endId);
        }
    }

    dispose(): void | Promise<void> {
        this.editorPoints.forEach((x) => {
            this.document.visualization.context.temporaryRemove(x);
        });
        this.editorPoints.length = 0;
    }
    pointerMove(view: IView, event: PointerEvent): void {}
    pointerDown(view: IView, event: PointerEvent): void {}
    pointerUp(view: IView, event: PointerEvent): void {}
    mouseWheel(view: IView, event: WheelEvent): void {}
    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            view.document.visualization.selection.clearSelected();
        }
    }
    keyUp(view: IView, event: KeyboardEvent): void {}
}
