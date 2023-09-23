// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    CursorType,
    I18nKeys,
    IDocument,
    IEventHandler,
    IModel,
    INode,
    IShapeFilter,
    Logger,
    PubSub,
    ShapeType,
} from "chili-core";
import { ModelSelectionHandler, ShapeSelectionHandler } from "chili-vis";

export class Selection {
    static async pickShape(
        document: IDocument,
        shapeType: ShapeType,
        prompt: I18nKeys,
        controller: AsyncController,
        multiMode: boolean = true,
        filter?: IShapeFilter,
    ) {
        let handler = new ShapeSelectionHandler(document, shapeType, multiMode, controller, filter);
        await this.pickAsync(document, handler, prompt, controller, multiMode === true);
        let shapes = handler.shapes();
        handler.dispose();
        return shapes;
    }

    static async pickModel(
        document: IDocument,
        prompt: I18nKeys,
        controller: AsyncController,
        multiMode: boolean = true,
    ) {
        let handler = new ModelSelectionHandler(document, multiMode, true, controller);
        await this.pickAsync(document, handler, prompt, controller, multiMode === true);
        let models = handler.models();
        handler.dispose();
        return models;
    }

    static async pickAsync(
        document: IDocument,
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType = CursorType.Selection,
    ) {
        let oldHandler = document.visual.eventHandler;
        document.visual.eventHandler = handler;
        document.visual.viewer.setCursor(cursor);
        PubSub.default.pub("statusBarTip", prompt);
        if (showControl) PubSub.default.pub("showSelectionControl", controller);
        await new Promise((resolve, reject) => {
            controller.onCompleted(resolve);
            controller.onCancelled(reject);
        })
            .catch((e) => Logger.info("pick status: ", e))
            .finally(() => {
                if (showControl) PubSub.default.pub("clearSelectionControl");
                PubSub.default.pub("clearStatusBarTip");
                document.visual.eventHandler = oldHandler;
                document.visual.viewer.setCursor(CursorType.Default);
            });
    }
}
