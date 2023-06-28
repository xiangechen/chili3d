// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    AsyncState,
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
        let token: AsyncState = new AsyncState();
        let handler = new ShapeSelectionHandler(document, shapeType, multiMode, token);
        await this.pickAsync(document, handler, prompt, token, showControl);
        let shapes = handler.shapes();
        handler.dispose();
        token.dispose();
        return shapes;
    }

    static async pickModel(
        document: IDocument,
        prompt: keyof I18n,
        multiMode: boolean = true,
        showControl: boolean = true
    ) {
        let token: AsyncState = new AsyncState();
        let handler = new ModelSelectionHandler(document, multiMode, token);
        await this.pickAsync(document, handler, prompt, token, showControl);
        handler.dispose();
        token.dispose();
        return document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x)) as IModel[];
    }

    static async pickAsync(
        document: IDocument,
        handler: IEventHandler,
        prompt: keyof I18n,
        token: AsyncState,
        showControl: boolean,
        cursor: CursorType = CursorType.Selection
    ) {
        let oldHandler = document.visual.eventHandler;
        document.visual.eventHandler = handler;
        document.visual.viewer.setCursor(cursor);
        PubSub.default.pub("statusBarTip", prompt);
        if (showControl) PubSub.default.pub("showSelectionControl", token);
        await new Promise((resolve, reject) => {
            token.onCompleted(resolve);
            token.onCancelled(reject);
        })
            .catch((e) => Logger.info(e))
            .finally(() => {
                token.dispose();
                if (showControl) PubSub.default.pub("clearSelectionControl");
                PubSub.default.pub("clearStatusBarTip");
                document.visual.eventHandler = oldHandler;
                document.visual.viewer.setCursor(CursorType.Default);
            });
    }
}
