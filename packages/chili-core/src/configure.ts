// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { PubSub } from "./pubsub";
import { ObjectSnapType } from "chili-ui/src/snap";

export class Configure {
    static _configure: Configure | undefined;

    static get current() {
        if (Configure._configure === undefined) {
            Configure._configure = new Configure();
        }
        return Configure._configure;
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

        PubSub.default.pub("snapChanged")(snapType);
    }
}
