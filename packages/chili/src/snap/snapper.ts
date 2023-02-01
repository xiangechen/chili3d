// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, CursorType, I18n, IDocument, IEventHandler, PubSub, XYZ } from "chili-core";
import { SnapEventHandlerBase } from "./snapEventHandlerBase";
import {
    SnapLengthAtAxisData,
    SnapLengthAtAxisHandler,
    SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
} from "./snapLengthEventHandler";

import { SnapPointData, SnapPointEventHandler } from "./snapPointHandler";

export class Snapper {
    constructor(readonly document: IDocument) {}

    async snapPointAsync(tipKey: keyof I18n, data: SnapPointData): Promise<XYZ | undefined> {
        return this.snap(SnapPointEventHandler, tipKey, data);
    }

    async snapLengthAtAxisAsync(tipKey: keyof I18n, data: SnapLengthAtAxisData): Promise<number | undefined> {
        let snapedPoint = await this.snap(SnapLengthAtAxisHandler, tipKey, data);
        return snapedPoint?.sub(data.point).dot(data.direction);
    }

    async snapLengthAtPlaneAsync(tipKey: keyof I18n, data: SnapLengthAtPlaneData): Promise<number | undefined> {
        let snapedPoint = await this.snap(SnapLengthAtPlaneHandler, tipKey, data);
        if (snapedPoint === undefined) return undefined;
        let point = data.plane.project(snapedPoint);
        return point.distanceTo(data.point);
    }

    private async snap<T extends SnapEventHandlerBase, D>(
        handler: new (token: CancellationToken, d: D) => T,
        tipKey: keyof I18n,
        data: D
    ) {
        let cancellationToken = new CancellationToken();
        let eventHandler = new handler(cancellationToken, data);
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
