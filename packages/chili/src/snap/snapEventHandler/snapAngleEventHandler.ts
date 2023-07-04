// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncState, IView, XYZ } from "chili-core";
import { SnapPointData, SnapPointEventHandler } from "./snapPointEventHandler";

export class SnapAngleEventHandler extends SnapPointEventHandler {
    constructor(token: AsyncState, center: SnapPointData, private p1: XYZ) {
        super(token, center);
    }

    protected override inputError(text: string) {
        let angle = Number.parseFloat(text);
        if (isNaN(angle)) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }

    protected override getPointFromInput(view: IView, text: string): XYZ {
        let angle = (Number.parseFloat(text) * Math.PI) / 180;
        let vec = this.p1.sub(this.pointData.refPoint!).normalize()!;
        vec = vec.rotate(this.pointData.plane!.normal, angle)!;
        return this.pointData.refPoint!.add(vec);
    }
}
