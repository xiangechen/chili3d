// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Lazy, PubSub } from "./foundation";
import { ObjectSnapType } from "./snapType";

export const VisualConfig = {
    defaultEdgeColor: 0x111111,
    defaultFaceColor: 0xdedede,
    highlightEdgeColor: 0x0000ee,
    highlightFaceColor: 0x0000ee,
    selectedEdgeColor: 0x2222ff,
    selectedFaceColor: 0x2222ff,
    editVertexSize: 7,
    editVertexColor: 0x0000ff,
    hintVertexSize: 5,
    hintVertexColor: 0x0000ff,
    trackingVertexSize: 7,
    trackingVertexColor: 0x0000ff,
    temporaryVertexSize: 5,
    temporaryVertexColor: 0x0000ff,
    temporaryEdgeColor: 0x0000ff,
};

export class Config {
    private static readonly _lazy = new Lazy(() => new Config());

    static get instance() {
        return this._lazy.value;
    }

    private _snapType: ObjectSnapType;
    get snapType() {
        return this._snapType;
    }

    set snapType(snapType: ObjectSnapType) {
        this._snapType = snapType;
        PubSub.default.pub("snapTypeChanged", snapType);
    }

    readonly SnapDistance: number = 5;

    constructor() {
        this._snapType =
            ObjectSnapType.midPoint |
            ObjectSnapType.endPoint |
            ObjectSnapType.center |
            ObjectSnapType.perpendicular |
            ObjectSnapType.intersection |
            ObjectSnapType.nearest;
    }
}
