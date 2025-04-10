// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { AsyncController, Config, IDocument, IView, Plane, PlaneAngle, XYZ } from "chili-core";
import { SnapResult } from "../snap";
import { ObjectSnap, PlaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import { PointSnapData } from "./pointSnapEventHandler";
import { SnapEventHandler } from "./snapEventHandler";

export class AngleSnapEventHandler extends SnapEventHandler<PointSnapData> {
    private readonly planeAngle: PlaneAngle;
    private readonly plane: Plane;

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly center: () => XYZ,
        p1: XYZ,
        snapPointData: PointSnapData,
    ) {
        if (!snapPointData.plane) throw new Error("AngleSnapEventHandler: no plane");

        const objectSnap = new ObjectSnap(Config.instance.snapType, snapPointData.refPoint);
        const workplaneSnap = new PlaneSnap(snapPointData.plane, center);
        const trackingSnap = new TrackingSnap(center, false);
        super(document, controller, [objectSnap, trackingSnap, workplaneSnap], snapPointData);

        const xvec = p1.sub(center()).normalize()!;
        this.plane = new Plane(center(), snapPointData.plane().normal, xvec);
        this.planeAngle = new PlaneAngle(this.plane);
        snapPointData.prompt ??= this.formatAnglePrompt;
    }

    private readonly formatAnglePrompt = (snaped?: SnapResult) => {
        if (!snaped?.point) return "";
        this.planeAngle.movePoint(snaped.point);
        return `${this.planeAngle.angle.toFixed(2)} °`;
    };

    protected override inputError(text: string) {
        const angle = Number.parseFloat(text);
        return isNaN(angle) ? "error.input.invalidNumber" : undefined;
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const angle = (Number.parseFloat(text) * Math.PI) / 180;
        const vec = this.plane.xvec.rotate(this.plane.normal, angle)!;
        const point = this.center().add(vec);
        return { point, view, shapes: [], plane: this.plane };
    }
}
