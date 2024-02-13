// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, CursorType, I18nKeys, IDocument, XYZ } from "chili-core";

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
    protected abstract getEventHandler(controller: AsyncController): SnapEventHandler;

    async snap(
        document: IDocument,
        tip: I18nKeys,
        controller: AsyncController,
    ): Promise<SnapedData | undefined> {
        let executorHandler = this.getEventHandler(controller);
        await document.selection.pickAsync(executorHandler, tip, controller, false, CursorType.Drawing);
        return controller.result?.status === "success" ? executorHandler.snaped : undefined;
    }
}

export class AngleSnapper extends Snapper {
    constructor(
        readonly center: XYZ,
        readonly p1: XYZ,
        readonly snapPointData: SnapPointData,
    ) {
        super();
    }

    protected getEventHandler(controller: AsyncController): SnapEventHandler {
        return new SnapAngleEventHandler(controller, this.center, this.p1, this.snapPointData);
    }
}

export class PointSnapper extends Snapper {
    constructor(readonly data: SnapPointData) {
        super();
    }

    protected getEventHandler(controller: AsyncController): SnapEventHandler {
        return new SnapPointEventHandler(controller, this.data);
    }
}

export class LengthAtAxisSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtAxisData) {
        super();
    }

    protected getEventHandler(controller: AsyncController): SnapEventHandler {
        return new SnapLengthAtAxisHandler(controller, this.data);
    }
}

export class LengthAtPlaneSnapper extends Snapper {
    constructor(readonly data: SnapLengthAtPlaneData) {
        super();
    }

    protected getEventHandler(controller: AsyncController): SnapEventHandler {
        return new SnapLengthAtPlaneHandler(controller, this.data);
    }
}
