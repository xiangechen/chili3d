// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, Config, I18nKeys, IDocument, IView, Plane, Precision, XYZ } from "chili-core";
import { SnapData, SnapedData } from "../snap";
import { AxisSnap, ObjectSnap, PlaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";

export interface LengthAtAxisSnapData extends SnapData {
    point: XYZ;
    direction: XYZ;
}

export interface SnapLengthAtPlaneData extends SnapData {
    point: () => XYZ;
    plane: () => Plane;
}

export class SnapLengthAtAxisHandler extends SnapEventHandler<LengthAtAxisSnapData> {
    constructor(document: IDocument, controller: AsyncController, lengthData: LengthAtAxisSnapData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType, () => lengthData.point);
        let axisSnap = new AxisSnap(lengthData.point, lengthData.direction);
        super(document, controller, [objectSnap, axisSnap], lengthData);
    }

    protected getPointFromInput(view: IView, text: string): SnapedData {
        let dist = Number(text);
        if (this.shouldReserse()) {
            dist = -dist;
        }
        let point = this.data.point.add(this.data.direction.multiply(dist));
        return {
            view,
            point,
            distance: dist,
            shapes: [],
        };
    }

    private shouldReserse() {
        return (
            this._snaped?.point &&
            this._snaped.point.sub(this.data.point).dot(this.data.direction) < -Precision.Distance
        );
    }

    protected inputError(text: string): I18nKeys | undefined {
        let n = Number(text);
        if (Number.isNaN(n)) return "error.input.invalidNumber";
        return undefined;
    }
}

export class SnapLengthAtPlaneHandler extends SnapEventHandler<SnapLengthAtPlaneData> {
    constructor(document: IDocument, controller: AsyncController, lengthData: SnapLengthAtPlaneData) {
        let objectSnap = new ObjectSnap(Config.instance.snapType, lengthData.point);
        let trackingSnap = new TrackingSnap(lengthData.point, false);
        let planeSnap = new PlaneSnap(lengthData.plane, lengthData.point);
        super(document, controller, [objectSnap, trackingSnap, planeSnap], lengthData);
    }

    protected getPointFromInput(view: IView, text: string): SnapedData {
        let point;
        let ns = text.split(",").map((x) => Number(x));
        if (ns.length === 1) {
            let vector = this._snaped?.point!.sub(this.data.point()).normalize();
            point = this.data.point().add(vector!.multiply(ns[0]));
        } else {
            let plane = this.data.plane();
            point = this.data.point().add(plane.xvec.multiply(ns[0])).add(plane.yvec.multiply(ns[1]));
        }

        return {
            point,
            view,
            shapes: [],
        };
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
