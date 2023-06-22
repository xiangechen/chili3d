// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncToken, CursorType, I18n, IDocument, IShape, Logger, PubSub, ShapeType } from "chili-core";
import { ShapeSelectionHandler } from "chili-vis";

export class Selection {
    constructor(readonly document: IDocument) {}

    pickPoint() {}

    async pickShape(shapeType: ShapeType, prompt: keyof I18n) {
        let beforeHandler = this.document.visual.eventHandler;
        let token: AsyncToken = new AsyncToken();
        let selectionHandler = new ShapeSelectionHandler(shapeType, false);
        this.document.visual.eventHandler = selectionHandler;
        await new Promise((resolve, reject) => {
            this.document.visual.viewer.setCursor(CursorType.Drawing);
            this.document.visual.eventHandler = selectionHandler!;
            PubSub.default.pub("statusBarTip", prompt);
            token.onCompleted(resolve);
            token.onCancelled(reject);
        })
            .then((r) => {
                Logger.info("complete selection");
            })
            .catch((r) => {
                Logger.info("cancel selection");
            })
            .finally(() => {
                PubSub.default.pub("clearStatusBarTip");
                this.document.visual.eventHandler = beforeHandler;
                this.document.visual.viewer.setCursor(CursorType.Default);
            });
        return selectionHandler.shapes;
    }
}
