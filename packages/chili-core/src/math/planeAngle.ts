// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Precision } from "../foundation";
import { Plane } from "./plane";
import { XYZ } from "./xyz";

export class PlaneAngle {
    private _preDotX: number = 1;
    private _preDotY: number = 0;
    private _reverse: boolean = false;
    private _angle: number = 0;
    get angle() {
        return this._angle;
    }

    constructor(readonly plane: Plane) {}

    movePoint(point: XYZ) {
        let vec = point.sub(this.plane.origin);
        let dotX = vec.dot(this.plane.xvec);
        let dotY = vec.dot(this.plane.yvec);

        if (this.crossXAxisAtXGreatThan0(dotX, dotY)) {
            this._reverse = !this._reverse;
        }

        this._angle = (this.plane.xvec.angleOnPlaneTo(vec, this.plane.normal)! * 180) / Math.PI;
        if (this._reverse) {
            this._angle -= 360;
        }

        if (Math.abs(dotX) > Precision.Distance) this._preDotX = dotX;
        if (Math.abs(dotY) > Precision.Distance) this._preDotY = dotY;
    }

    private crossXAxisAtXGreatThan0(dotX: number, dotY: number) {
        let crossXfromBottomToTop =
            this._preDotY < -Precision.Distance &&
            dotY > Precision.Distance &&
            this._angle < Precision.Angle;
        let crossXfromTopToBottom =
            this._preDotY > -Precision.Distance &&
            dotY < -Precision.Distance &&
            this._angle > -Precision.Angle;
        let crossX = crossXfromBottomToTop || crossXfromTopToBottom;
        return crossX && this._preDotX > 0 && dotX > 0;
    }
}
