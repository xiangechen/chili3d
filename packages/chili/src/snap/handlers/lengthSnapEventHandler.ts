// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, Config, I18nKeys, IDocument, IView, Plane, Precision, XYZ } from "chili-core";
import { SnapData, SnapResult } from "../snap";
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
        const point = this.calculatePoint(dist);
        return { view, point, distance: dist, shapes: [] };
    }

    private calculateDistance(inputValue: number): number {
        return this.shouldReverse() ? -inputValue : inputValue;
    }

    private calculatePoint(distance: number): XYZ {
        return this.data.point.add(this.data.direction.multiply(distance));
    }

    private shouldReverse() {
        return (
            this._snaped?.point &&
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
        return { point, view, shapes: [], plane };
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
        return this.data.point().add(plane.xvec.multiply(coords[0])).add(plane.yvec.multiply(coords[1]));
    }

    protected inputError(text: string): I18nKeys | undefined {
        const numbers = text.split(",").map(Number);
        if (numbers.some(Number.isNaN) || (numbers.length !== 1 && numbers.length !== 2)) {
            return "error.input.invalidNumber";
        }
        return undefined;
    }
}
