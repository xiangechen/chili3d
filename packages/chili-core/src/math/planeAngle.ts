// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Precision } from "../base";
import { Plane } from "./plane";
import { XYZ } from "./xyz";

export class PlaneAngle {
    #preDotX: number = 1;
    #preDotY: number = 0;
    #reverse: boolean = false;
    #angle: number = 0;
    get angle() {
        return this.#angle;
    }

    constructor(readonly plane: Plane) {}

    movePoint(point: XYZ) {
        let vec = point.sub(this.plane.origin);
        let dotX = vec.dot(this.plane.xvec);
        let dotY = vec.dot(this.plane.yvec);

        if (
            ((this.#preDotY < -Precision.Distance &&
                dotY > Precision.Distance &&
                this.#angle < Precision.Distance) ||
                (this.#preDotY > -Precision.Distance &&
                    dotY < -Precision.Distance &&
                    this.#angle > -Precision.Distance)) && // 确保穿过 0
            this.#preDotX > 0 &&
            dotX > 0
        ) {
            this.#reverse = !this.#reverse;
        }
        this.#angle = (this.plane.xvec.angleOnPlaneTo(vec, this.plane.normal)! * 180) / Math.PI;
        if (this.#reverse) {
            this.#angle -= 360;
        }
        if (Math.abs(dotX) > Precision.Distance) this.#preDotX = dotX;
        if (Math.abs(dotY) > Precision.Distance) this.#preDotY = dotY;
    }
}
