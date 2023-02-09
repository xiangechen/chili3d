// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, Configure, IShape, IView, Plane, Validation, XYZ } from "chili-core";

import { ObjectSnap } from "../objectSnap";
import { PlaneSnap } from "../planeSnap";
import { AxisTracking } from "../tracking";
import { ShapePreviewer, Validator } from "./interfaces";
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
    constructor(cancellationToken: CancellationToken, readonly lengthData: SnapLengthAtAxisData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let axisTracking = new AxisTracking(lengthData.point, lengthData.direction);
        super({
            cancellationToken,
            snaps: [objectSnap, axisTracking],
            validator: lengthData.validator,
            preview: lengthData.preview,
        });
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        return this.lengthData.point.add(this.lengthData.direction.multiply(Number(text)));
    }

    protected isValidInput(text: string) {
        let n = Number(text);
        if (Number.isNaN(n)) return Validation.error("error.input.invalidNumber");
        return Validation.ok();
    }
}

export class SnapLengthAtPlaneHandler extends SnapEventHandler {
    constructor(cancellationToken: CancellationToken, readonly lengthData: SnapLengthAtPlaneData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let planeSnap = new PlaneSnap(lengthData.plane);
        super({
            cancellationToken,
            snaps: [objectSnap, planeSnap],
            validator: lengthData.validator,
            preview: lengthData.preview,
        });
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

    protected isValidInput(text: string) {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.some((x) => Number.isNaN(x))) return Validation.error("error.input.invalidNumber");
        if (ns.length !== 1 && ns.length !== 2) {
            return Validation.error("error.input.invalidNumber");
        }
        return Validation.ok();
    }
}
