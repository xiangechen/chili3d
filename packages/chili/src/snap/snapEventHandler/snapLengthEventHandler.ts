// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { AsyncToken, Config, I18n, IView, Plane, XYZ } from "chili-core";

import { AxisSnap } from "../axisSnap";
import { ShapePreviewer, Validator } from "../interfaces";
import { ObjectSnap } from "../objectSnap";
import { PlaneSnap } from "../planeSnap";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";

export interface SnapLengthAtAxisData {
    point: XYZ;
    direction: XYZ;
    validator?: Validator;
    preview: ShapePreviewer;
}

export interface SnapLengthAtPlaneData {
    point: XYZ;
    plane: Plane;
    validator?: Validator;
    preview: ShapePreviewer;
}

export class SnapLengthAtAxisHandler extends SnapEventHandler {
    constructor(token: AsyncToken, readonly lengthData: SnapLengthAtAxisData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType);
        let axisSnap = new AxisSnap(lengthData.point, lengthData.direction);
        super(token, [objectSnap, axisSnap], lengthData.validator, lengthData.preview);
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        return this.lengthData.point.add(this.lengthData.direction.multiply(Number(text)));
    }

    protected getErrorMessage(text: string): keyof I18n | undefined {
        let n = Number(text);
        if (Number.isNaN(n)) return "error.input.invalidNumber";
        return undefined;
    }
}

export class SnapLengthAtPlaneHandler extends SnapEventHandler {
    constructor(token: AsyncToken, readonly lengthData: SnapLengthAtPlaneData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType);
        let trackingSnap = new TrackingSnap(lengthData.point, false);
        let planeSnap = new PlaneSnap(lengthData.plane);
        super(token, [objectSnap, trackingSnap, planeSnap], lengthData.validator, lengthData.preview);
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.length === 1) {
            let vector = this._snaped?.point.sub(this.lengthData.point).normalize();
            return this.lengthData.point.add(vector!.multiply(ns[0]));
        }
        return this.lengthData.point
            .add(this.lengthData.plane.x.multiply(ns[0]))
            .add(this.lengthData.plane.y.multiply(ns[1]));
    }

    protected getErrorMessage(text: string): keyof I18n | undefined {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.some((x) => Number.isNaN(x))) return "error.input.invalidNumber";
        if (ns.length !== 1 && ns.length !== 2) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }
}
