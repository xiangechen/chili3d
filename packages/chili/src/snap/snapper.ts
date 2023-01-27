// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, I18n, XYZ } from "chili-core";
import { SnapData, SnapPointEventHandler } from "./snapPointHandler";
import { CursorType, IEventHandler, IDocument, PubSub } from "chili-core";

export class Snapper {
    constructor(readonly document: IDocument) {}

    async snapPointAsync(tipKey: keyof I18n, data: SnapData): Promise<XYZ | undefined> {
        let cancellationToken = new CancellationToken();
        let eventHandler = new SnapPointEventHandler(cancellationToken, data);
        await this.handleSnapAsync(eventHandler, tipKey, cancellationToken);
        return eventHandler.snapedPoint;
    }

    async snapLengthAsync(tipKey: keyof I18n, data: SnapData): Promise<XYZ | undefined> {
        let cancellationToken = new CancellationToken();
        let eventHandler = new SnapPointEventHandler(cancellationToken, data);
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
