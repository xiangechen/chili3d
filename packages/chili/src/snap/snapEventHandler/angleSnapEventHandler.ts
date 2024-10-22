// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, Config, IDocument, IView, Plane, PlaneAngle, XYZ } from "chili-core";
import { SnapedData } from "../snap";
import { ObjectSnap, PlaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import { PointSnapData } from "./pointSnapData";
import { SnapEventHandler } from "./snapEventHandler";

export class AngleSnapEventHandler extends SnapEventHandler<PointSnapData> {
    readonly plane: Plane;
    readonly planeAngle: PlaneAngle;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly center: () => XYZ,
        p1: XYZ,
        snapPointData: PointSnapData,
    ) {
        if (!snapPointData.plane) throw new Error("AngleSnapEventHandler: no plane");
        let objectSnap = new ObjectSnap(Config.instance.snapType, snapPointData.refPoint);
        let workplaneSnap = new PlaneSnap(snapPointData.plane, center);
        let trackingSnap = new TrackingSnap(center, false);
        let snaps = [objectSnap, trackingSnap, workplaneSnap];
        super(document, controller, snaps, snapPointData);
        let xvec = p1.sub(center()).normalize()!;
        this.plane = new Plane(center(), snapPointData.plane().normal, xvec);
        this.planeAngle = new PlaneAngle(this.plane);
        if (snapPointData.prompt === undefined) snapPointData.prompt = this.snapedInfo;
    }

    private readonly snapedInfo = (snaped?: SnapedData) => {
        this.planeAngle.movePoint(snaped?.point!);
        return `${this.planeAngle.angle.toFixed(2)} °`;
    };

    protected override inputError(text: string) {
        let angle = Number.parseFloat(text);
        if (isNaN(angle)) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }

    protected override getPointFromInput(view: IView, text: string): SnapedData {
        let angle = (Number.parseFloat(text) * Math.PI) / 180;
        let vec = this.plane.xvec.rotate(this.plane.normal, angle)!;
        let point = this.center().add(vec);
        return {
            point,
            view,
            shapes: [],
        };
    }
}
