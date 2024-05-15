// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Lazy, PubSub } from "./foundation";
import { ObjectSnapType } from "./snapType";

export const VisualConfig = {
    defaultEdgeColor: 0x121314,
    defaultFaceColor: 0xdedede,
    highlightEdgeColor: 0xfef08a,
    highlightFaceColor: 0xfef08a,
    selectedEdgeColor: 0xffffff,
    selectedFaceColor: 0xfde047,
    editVertexSize: 5,
    editVertexColor: 0x0000ff,
    hintVertexSize: 3,
    hintVertexColor: 0x0000ff,
    trackingVertexSize: 5,
    trackingVertexColor: 0x0000ff,
    temporaryVertexSize: 3,
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
            ObjectSnapType.intersection;
    }
}
