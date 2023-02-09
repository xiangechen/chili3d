// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, CursorType, I18n, IDocument, Plane, PubSub } from "chili-core";

import { SnapedData } from "./interfaces";
import { SnapEventHandler } from "./snapEventHandler";
import {
    SnapLengthAtAxisData,
    SnapLengthAtAxisHandler,
    SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
} from "./snapLengthEventHandler";
import { SnapPointData, SnapPointEventHandler } from "./snapPointHandler";

export abstract class Snapper {
    protected eventHandler?: SnapEventHandler;
    protected cancellationToken: CancellationToken;

    constructor() {
        this.cancellationToken = new CancellationToken();
    }

    protected abstract getEventHandler(): SnapEventHandler;

    async snap(document: IDocument, tip: keyof I18n): Promise<SnapedData | undefined> {
        if (this.eventHandler === undefined) this.eventHandler = this.getEventHandler();
        let defaultEventHandler = document.visualization.eventHandler;
        document.viewer.setCursor(CursorType.Drawing);
        PubSub.default.pub("statusBarTip", tip);
        document.visualization.eventHandler = this.eventHandler;
        while (!this.cancellationToken.isCanceled) {
            await new Promise((r) => setTimeout(r, 30));
        }
        document.visualization.eventHandler = defaultEventHandler;
        document.viewer.setCursor(CursorType.Default);
        PubSub.default.pub("clearStatusBarTip");
        return this.eventHandler.snaped;
    }
}

export class PointSnapper extends Snapper {
    constructor(readonly data: SnapPointData) {
        super();
    }

    protected getEventHandler(): SnapEventHandler {
        return new SnapPointEventHandler(this.cancellationToken, this.data);
    }
}

export class LengthAtAxisSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtAxisData) {
        super();
    }

    protected getEventHandler(): SnapEventHandler {
        return new SnapLengthAtAxisHandler(this.cancellationToken, this.data);
    }
}

export class LengthAtPlaneSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtPlaneData) {
        super();
    }

    protected getEventHandler(): SnapEventHandler {
        return new SnapLengthAtPlaneHandler(this.cancellationToken, this.data);
    }
}
