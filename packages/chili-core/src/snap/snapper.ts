// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { XYZ } from "chili-shared";
import { CursorType, IEventHandler } from "chili-vis";
import { SnapPointEventHandler } from "./snapPointHandler";
import { IDocument, PubSub } from "chili-core";
import { Dimension } from "./inputDimension";
import { HandleTempShape } from "./shapeHandle";

export class Snapper {
    private _stopSnap: boolean = false;

    constructor(readonly document: IDocument) {}

    async snapPointAsync(
        dimension: Dimension,
        tip: string,
        refPoint?: XYZ,
        handleTempShape?: HandleTempShape
    ): Promise<XYZ | undefined> {
        let eventHandler = new SnapPointEventHandler(
            this.document,
            this.stopSnap,
            dimension,
            refPoint,
            handleTempShape
        );
        await this.handleSnapAsync(eventHandler, tip);
        return eventHandler.snapedPoint;
    }

    private async handleSnapAsync(eventHandler: IEventHandler, tip: string, cursor: CursorType = CursorType.Drawing) {
        this._stopSnap = false;
        let defaultEventHandler = this.document.visualization.eventHandler;
        this.document.viewer.setCursor(cursor);
        PubSub.default.pub("statusBarTip")(tip);
        this.document.visualization.eventHandler = eventHandler;
        while (!this._stopSnap) {
            await new Promise((r) => setTimeout(r, 10));
        }
        this.document.visualization.eventHandler = defaultEventHandler;
        this.document.viewer.setCursor(CursorType.Default);
        PubSub.default.pub("clearStatusBarTip")();
    }

    stopSnap = () => {
        this._stopSnap = true;
    };
}
