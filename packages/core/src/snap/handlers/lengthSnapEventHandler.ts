// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../../config";
import type { IDocument } from "../../document";
import { type AsyncController, Precision } from "../../foundation";
import type { I18nKeys } from "../../i18n";
import type { Plane, XYZ } from "../../math";
import type { IView } from "../../visual";
import type { SnapData, SnapResult } from "../snap";
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

    protected getPointFromInput(view: IView, text: string): SnapResult {
        const dist = this.calculateDistance(Number(text));
        const point = this.data.point.add(this.data.direction.multiply(dist));
        return { view, point, distance: Math.abs(dist), shapes: [], type: "input" };
    }

    private calculateDistance(inputValue: number): number {
        return this.isSnapedOnNegativeSide() ? -inputValue : inputValue;
    }

    private isSnapedOnNegativeSide() {
        return (
            this._snaped?.point !== undefined &&
            this._snaped.point.sub(this.data.point).dot(this.data.direction) < -Precision.Distance
        );
    }

    protected inputError(text: string): I18nKeys | undefined {
        return Number.isNaN(Number(text)) ? "error.input.invalidNumber" : undefined;
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

    protected override setSnaped(view: IView, event: PointerEvent): void {
        super.setSnaped(view, event);
        this.updateWorkplane();
    }

    private updateWorkplane() {
        if (this._snaped) {
            this.workplane = this.lengthData.plane(this._snaped.point);
            this._snaped.plane = this.workplane;
        }
    }

    protected getPointFromInput(view: IView, text: string): SnapResult {
        const plane = this.workplane ?? view.workplane;
        const point = this.calculatePoint(text, plane);
        return { point, view, shapes: [], plane, type: "input" };
    }

    private calculatePoint(text: string, plane: Plane): XYZ {
        const numbers = text.split(",").map(Number);
        return numbers.length === 1
            ? this.calculatePointFromDistance(numbers[0])
            : this.calculatePointFromCoordinates(numbers, plane);
    }

    private calculatePointFromDistance(distance: number): XYZ {
        const vector = this._snaped?.point!.sub(this.data.point()).normalize();
        return this.data.point().add(vector!.multiply(distance));
    }

    private calculatePointFromCoordinates(coords: number[], plane: Plane): XYZ {
        const refPoint = this.data.point();
        const dx = this.followSnapedSign(refPoint, plane.xvec, coords[0]);
        const dy = this.followSnapedSign(refPoint, plane.yvec, coords[1]);
        return refPoint.add(plane.xvec.multiply(dx)).add(plane.yvec.multiply(dy));
    }

    protected inputError(text: string): I18nKeys | undefined {
        const numbers = text.split(",").map(Number);
        if (numbers.some(Number.isNaN) || (numbers.length !== 1 && numbers.length !== 2)) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }
}
