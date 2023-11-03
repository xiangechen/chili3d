// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, Config, IView, Plane, PlaneAngle, Precision, XYZ } from "chili-core";
import { ObjectSnap } from "../objectSnap";
import { PlaneSnap } from "../planeSnap";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";
import { SnapPointData } from "./snapPointEventHandler";

export class SnapAngleEventHandler extends SnapEventHandler {
    readonly plane: Plane;
    readonly planeAngle: PlaneAngle;

    constructor(
        controller: AsyncController,
        readonly center: XYZ,
        p1: XYZ,
        readonly snapPointData: SnapPointData,
    ) {
        if (!snapPointData.plane) throw new Error("SnapAngleEventHandler requires a plane");
        let objectSnap = new ObjectSnap(Config.instance.snapType, snapPointData.refPoint);
        let workplaneSnap = new PlaneSnap(snapPointData.plane, center);
        let trackingSnap = new TrackingSnap(center, false);
        let snaps = [objectSnap, trackingSnap, workplaneSnap];
        super(controller, snaps, snapPointData);
        let xvec = p1.sub(center).normalize()!;
        this.plane = new Plane(center, snapPointData.plane.normal, xvec);
        this.planeAngle = new PlaneAngle(this.plane);
    }

    override snapedInfo() {
        this.planeAngle.movePoint(this._snaped?.point!);
        return `${this.planeAngle.angle.toFixed(2)} °`;
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
        let vec = this.plane.xvec.rotate(this.plane.normal, angle)!;
        return this.center.add(vec);
    }
}
