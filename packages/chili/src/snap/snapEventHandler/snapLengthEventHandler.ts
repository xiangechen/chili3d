// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, Config, I18nKeys, IDocument, IView, Plane, Precision, XYZ } from "chili-core";
import { AxisSnap } from "../axisSnap";
import { SnapPreviewer, SnapValidator, SnapedData } from "../interfaces";
import { ObjectSnap } from "../objectSnap";
import { PlaneSnap } from "../planeSnap";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";

export interface SnapLengthAtAxisData {
    point: XYZ;
    direction: XYZ;
    validators?: SnapValidator[];
    preview: SnapPreviewer;
    prompt?: (snaped: SnapedData) => string;
}

export interface SnapLengthAtPlaneData {
    point: () => XYZ;
    plane: () => Plane;
    validators?: SnapValidator[];
    preview: SnapPreviewer;
    prompt?: (snaped: SnapedData) => string;
}

export class SnapLengthAtAxisHandler extends SnapEventHandler {
    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly lengthData: SnapLengthAtAxisData,
    ) {
        let objectSnap = new ObjectSnap(Config.instance.snapType, () => lengthData.point);
        let axisSnap = new AxisSnap(lengthData.point, lengthData.direction);
        super(document, controller, [objectSnap, axisSnap], lengthData);
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        let dist = Number(text);
        if (
            this._snaped?.point &&
            this._snaped.point.sub(this.lengthData.point).dot(this.lengthData.direction) <
                -Precision.Distance
        ) {
            dist = -dist;
        }
        return this.lengthData.point.add(this.lengthData.direction.multiply(dist));
    }

    protected inputError(text: string): I18nKeys | undefined {
        let n = Number(text);
        if (Number.isNaN(n)) return "error.input.invalidNumber";
        return undefined;
    }
}

export class SnapLengthAtPlaneHandler extends SnapEventHandler {
    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly lengthData: SnapLengthAtPlaneData,
    ) {
        let objectSnap = new ObjectSnap(Config.instance.snapType, lengthData.point);
        let trackingSnap = new TrackingSnap(lengthData.point, false);
        let planeSnap = new PlaneSnap(lengthData.plane, lengthData.point);
        super(document, controller, [objectSnap, trackingSnap, planeSnap], lengthData);
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.length === 1) {
            let vector = this._snaped?.point!.sub(this.lengthData.point()).normalize();
            return this.lengthData.point().add(vector!.multiply(ns[0]));
        }
        let plane = this.lengthData.plane();
        return this.lengthData.point().add(plane.xvec.multiply(ns[0])).add(plane.yvec.multiply(ns[1]));
    }

    protected inputError(text: string): I18nKeys | undefined {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.some((x) => Number.isNaN(x))) return "error.input.invalidNumber";
        if (ns.length !== 1 && ns.length !== 2) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }
}
