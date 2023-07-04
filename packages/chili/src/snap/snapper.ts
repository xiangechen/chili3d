// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, CursorType, I18n, IDocument, XYZ } from "chili-core";

import { Selection } from "../selection";
import { SnapedData } from "./interfaces";
import {
    SnapAngleEventHandler,
    SnapEventHandler,
    SnapLengthAtAxisData,
    SnapLengthAtAxisHandler,
    SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
    SnapPointData,
    SnapPointEventHandler,
} from "./snapEventHandler";

export abstract class Snapper {
    protected abstract getEventHandler(token: AsyncState): SnapEventHandler;

    async snap(document: IDocument, tip: keyof I18n): Promise<SnapedData | undefined> {
        let token: AsyncState = new AsyncState();
        let executorHandler = this.getEventHandler(token);
        await Selection.pickAsync(document, executorHandler, tip, token, false, CursorType.Drawing);
        return executorHandler.snaped;
    }
}

export class AngleSnapper extends Snapper {
    constructor(readonly center: SnapPointData, readonly p1: XYZ) {
        super();
    }

    protected getEventHandler(token: AsyncState): SnapEventHandler {
        return new SnapAngleEventHandler(token, this.center, this.p1);
    }
}

export class PointSnapper extends Snapper {
    constructor(readonly data: SnapPointData) {
        super();
    }

    protected getEventHandler(token: AsyncState): SnapEventHandler {
        return new SnapPointEventHandler(token, this.data);
    }
}

export class LengthAtAxisSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtAxisData) {
        super();
    }

    protected getEventHandler(token: AsyncState): SnapEventHandler {
        return new SnapLengthAtAxisHandler(token, this.data);
    }
}

export class LengthAtPlaneSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtPlaneData) {
        super();
    }

    protected getEventHandler(token: AsyncState): SnapEventHandler {
        return new SnapLengthAtPlaneHandler(token, this.data);
    }
}
