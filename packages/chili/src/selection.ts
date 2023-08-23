// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncController,
    CursorType,
    I18n,
    IDocument,
    IEventHandler,
    IModel,
    INode,
    Logger,
    PubSub,
    ShapeType,
} from "chili-core";
import { ModelSelectionHandler, ShapeSelectionHandler } from "chili-vis";

export class Selection {
    static async pickShape(
        document: IDocument,
        shapeType: ShapeType,
        prompt: keyof I18n,
        multiMode: boolean = true,
        showControl: boolean = true
    ) {
        let controller: AsyncController = new AsyncController();
        let handler = new ShapeSelectionHandler(document, shapeType, multiMode, controller);
        await this.pickAsync(document, handler, prompt, controller, showControl);
        let shapes = handler.shapes();
        handler.dispose();
        controller.dispose();
        return shapes;
    }

    static async pickModel(
        document: IDocument,
        prompt: keyof I18n,
        controller: AsyncController,
        multiMode: boolean = true,
        showControl: boolean = true
    ) {
        let handler = new ModelSelectionHandler(document, multiMode, controller);
        await this.pickAsync(document, handler, prompt, controller, showControl).finally(() =>
            handler.dispose()
        );
        return document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x)) as IModel[];
    }

    static async pickAsync(
        document: IDocument,
        handler: IEventHandler,
        prompt: keyof I18n,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType = CursorType.Selection
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
