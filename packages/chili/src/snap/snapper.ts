// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { TaskManager, CursorType, I18n, IDocument, PubSub, Logger } from "chili-core";

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
    protected abstract getEventHandler(token: TaskManager): SnapEventHandler;

    async snap(document: IDocument, tip: keyof I18n): Promise<SnapedData | undefined> {
        let token: TaskManager = new TaskManager();
        let executorHandler = this.getEventHandler(token);
        let beforeHandler = document.visual.eventHandler;
        await new Promise((resolve, reject) => {
            document.visual.viewer.setCursor(CursorType.Drawing);
            document.visual.eventHandler = executorHandler!;
            PubSub.default.pub("statusBarTip", tip);
            token.onCompleted(resolve);
            token.onCancelled(reject);
        })
            .then((r) => {
                Logger.info("complete snap");
            })
            .catch((r) => {
                Logger.info("cancel snap");
            })
            .finally(() => {
                PubSub.default.pub("clearStatusBarTip");
                document.visual.eventHandler = beforeHandler;
                document.visual.viewer.setCursor(CursorType.Default);
            });
        return executorHandler.snaped;
    }
}

export class PointSnapper extends Snapper {
    constructor(readonly data: SnapPointData) {
        super();
    }

    protected getEventHandler(token: TaskManager): SnapEventHandler {
        return new SnapPointEventHandler(token, this.data);
    }
}

export class LengthAtAxisSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtAxisData) {
        super();
    }

    protected getEventHandler(token: TaskManager): SnapEventHandler {
        return new SnapLengthAtAxisHandler(token, this.data);
    }
}

export class LengthAtPlaneSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtPlaneData) {
        super();
    }

    protected getEventHandler(token: TaskManager): SnapEventHandler {
        return new SnapLengthAtPlaneHandler(token, this.data);
    }
}
