// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { TaskToken, CursorType, I18n, IDocument, PubSub, Logger } from "chili-core";

import {
    SnapEventHandler,
    SnapLengthAtAxisData,
    SnapLengthAtAxisHandler,
    SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
    SnapPointData,
    SnapPointEventHandler,
} from "./snapEventHandler";
import { SnapedData } from "./interfaces";

export abstract class Snapper {
    protected readonly taskToken: TaskToken = new TaskToken();

    protected abstract getEventHandler(): SnapEventHandler;

    async snap(document: IDocument, tip: keyof I18n): Promise<SnapedData | undefined> {
        let eventHandler = this.getEventHandler();
        document.visual.viewer.setCursor(CursorType.Drawing);
        PubSub.default.pub("statusBarTip", tip);
        await this.waitEventHandlerFinished(document, eventHandler);
        document.visual.viewer.setCursor(CursorType.Default);
        PubSub.default.pub("clearStatusBarTip");
        return eventHandler.snaped;
    }

    protected async waitEventHandlerFinished(document: IDocument, eventHandler: SnapEventHandler) {
        let handler = document.visual.eventHandler;
        document.visual.eventHandler = eventHandler!;
        await new Promise((resolve, reject) => {
            this.taskToken.onCompletedRequested(resolve);
            this.taskToken.onCancellationRequested(reject);
        })
            .then((r) => {
                Logger.info("complete snap");
            })
            .catch((r) => {
                Logger.info("cancel snap");
            });
        document.visual.eventHandler = handler;
    }
}

export class PointSnapper extends Snapper {
    constructor(readonly data: SnapPointData) {
        super();
    }

    protected getEventHandler(): SnapEventHandler {
        return new SnapPointEventHandler(this.taskToken, this.data);
    }
}

export class LengthAtAxisSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtAxisData) {
        super();
    }

    protected getEventHandler(): SnapEventHandler {
        return new SnapLengthAtAxisHandler(this.taskToken, this.data);
    }
}

export class LengthAtPlaneSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtPlaneData) {
        super();
    }

    protected getEventHandler(): SnapEventHandler {
        return new SnapLengthAtPlaneHandler(this.taskToken, this.data);
    }
}
