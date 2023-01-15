// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, i18n, I18n, XYZ } from "chili-shared";
import { CursorType, IEventHandler } from "chili-vis";
import { SnapPointEventHandler } from "./snapPointHandler";
import { IDocument, PubSub } from "chili-core";
import { Dimension } from "./inputDimension";
import { HandleTempShape } from "./shapeHandle";

export class Snapper {
    constructor(readonly document: IDocument) {}

    async snapPointAsync(
        dimension: Dimension,
        tipKey: keyof I18n,
        refPoint?: XYZ,
        handleTempShape?: HandleTempShape
    ): Promise<XYZ | undefined> {
        let cancellationToken = new CancellationToken();
        let eventHandler = new SnapPointEventHandler(cancellationToken, dimension, refPoint, handleTempShape);
        await this.handleSnapAsync(eventHandler, tipKey, cancellationToken);
        return eventHandler.snapedPoint;
    }

    private async handleSnapAsync(
        eventHandler: IEventHandler,
        tipKey: keyof I18n,
        cancellationToken: CancellationToken,
        cursor: CursorType = CursorType.Drawing
    ) {
        let defaultEventHandler = this.document.visualization.eventHandler;
        this.document.viewer.setCursor(cursor);
        PubSub.default.pub("statusBarTip", tipKey);
        this.document.visualization.eventHandler = eventHandler;
        while (!cancellationToken.isCanceled) {
            await new Promise((r) => setTimeout(r, 30));
        }
        this.document.visualization.eventHandler = defaultEventHandler;
        this.document.viewer.setCursor(CursorType.Default);
        PubSub.default.pub("clearStatusBarTip");
    }
}
