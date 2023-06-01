// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Lazy, PubSub } from "../base";
import { ObjectSnapType } from "../snapType";

export class Configure {
    private static readonly _lazy = new Lazy(() => new Configure());

    static get instance() {
        return this._lazy.value;
    }

    private _snapType: ObjectSnapType;

    constructor() {
        this._snapType =
            ObjectSnapType.midPoint |
            ObjectSnapType.endPoint |
            ObjectSnapType.center |
            ObjectSnapType.perpendicular |
            ObjectSnapType.intersection;
    }

    get snapType() {
        return this._snapType;
    }

    set snapType(snapType: ObjectSnapType) {
        this._snapType = snapType;
        PubSub.default.pub("snapChanged", snapType);
    }
}
