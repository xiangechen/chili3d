// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, Lazy, PubSub } from "./base";
import { ObjectSnapType } from "./snapType";

export class VisualConfig {
    faceEdgeColor: Color = Color.fromRGB(0.75, 0.75, 0.75);
    highlightEdgeColor: Color = Color.fromRGB(0.95, 0.95, 0.95);
    highlightFaceColor: Color = Color.fromHex(0xfef08a);
    selectedEdgeColor: Color = Color.fromRGB(1, 1, 1);
    selectedFaceColor: Color = Color.fromHex(0xfde047);
    editVertexSize: number = 5;
    editVertexColor: Color = Color.fromHex(0x666);
    hintVertexSize: number = 3;
    hintVertexColor: Color = Color.fromHex(0x666);
    trackingVertexSize: number = 5;
    trackingVertexColor: Color = Color.fromHex(0x888);
    temporaryVertexSize: number = 3;
    temporaryVertexColor: Color = Color.fromHex(0x888);
    temporaryEdgeColor: Color = Color.fromHex(0x888);
}

export class Config {
    private static readonly _lazy = new Lazy(() => new Config());

    static get instance() {
        return this._lazy.value;
    }

    readonly visual: VisualConfig = new VisualConfig();

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
