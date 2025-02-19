// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, Config, I18nKeys, IDocument, IView, Plane, Precision, Ray, XYZ } from "chili-core";
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
    plane: (point: XYZ | undefined) => Plane;
}

export class SnapLengthAtAxisHandler extends SnapEventHandler<LengthAtAxisSnapData> {
    constructor(document: IDocument, controller: AsyncController, lengthData: LengthAtAxisSnapData) {
        const objectSnap = new ObjectSnap(Config.instance.snapType, () => lengthData.point);
        const axisSnap = new AxisSnap(lengthData.point, lengthData.direction);
        super(document, controller, [objectSnap, axisSnap], lengthData);
    }

    protected getPointFromInput(view: IView, text: string): SnapedData {
        let dist = Number(text);
        dist = this.shouldReserse() ? -dist : dist;
        const point = this.data.point.add(this.data.direction.multiply(dist));
        return { view, point, distance: dist, shapes: [] };
    }

    private shouldReserse() {
        return (
            this._snaped?.point &&
            this._snaped.point.sub(this.data.point).dot(this.data.direction) < -Precision.Distance
        );
    }

    protected inputError(text: string): I18nKeys | undefined {
        const n = Number(text);
        return Number.isNaN(n) ? "error.input.invalidNumber" : undefined;
    }
}

export class SnapLengthAtPlaneHandler extends SnapEventHandler<SnapLengthAtPlaneData> {
    private workplane: Plane | undefined;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly lengthData: SnapLengthAtPlaneData,
    ) {
        const objectSnap = new ObjectSnap(Config.instance.snapType, lengthData.point);
        const trackingSnap = new TrackingSnap(lengthData.point, false);
        const planeSnap = new PlaneSnap(lengthData.plane, lengthData.point);
        super(document, controller, [objectSnap, trackingSnap, planeSnap], lengthData);
    }

    protected override setSnaped(view: IView, event: MouseEvent): void {
        super.setSnaped(view, event);

        if (this._snaped !== undefined) {
            this.workplane = this.lengthData.plane(this._snaped.point);
            this._snaped.plane = this.workplane;
        }
    }

    protected getPointFromInput(view: IView, text: string): SnapedData {
        let plane = this.workplane ?? view.workplane;

        let point;
        let ns = text.split(",").map((x) => Number(x));
        if (ns.length === 1) {
            let vector = this._snaped?.point!.sub(this.data.point()).normalize();
            point = this.data.point().add(vector!.multiply(ns[0]));
        } else {
            point = this.data.point().add(plane.xvec.multiply(ns[0])).add(plane.yvec.multiply(ns[1]));
        }

        return {
            point,
            view,
            shapes: [],
            plane,
        };
    }

    protected inputError(text: string): I18nKeys | undefined {
        const ns = text.split(",").map(Number);
        if (ns.some(Number.isNaN) || (ns.length !== 1 && ns.length !== 2)) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }
}
