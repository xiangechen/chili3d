// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../../config";
import type { IDocument } from "../../document";
import { type AsyncController, Precision } from "../../foundation";
import type { I18nKeys } from "../../i18n";
import { type Line, type Plane, XYZ } from "../../math";
import type { ICurve, ShapeType } from "../../shape";
import type { IView } from "../../visual";
import { type Dimension, DimensionUtils, parseDimensionInput } from "../dimension";
import type { ISnap, SnapData, SnapResult } from "../snap";
import { AxisSnap, ObjectSnap, PlaneSnap, PointOnCurveSnap, SurfaceSnap, WorkplaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";

export interface PointSnapData extends SnapData {
    dimension?: Dimension;
    refPoint?: () => XYZ;
    plane?: (point?: XYZ) => Plane;
}

export interface SnapPointOnCurveData extends PointSnapData {
    curve: ICurve;
}

export interface SnapPointOnAxisData extends PointSnapData {
    ray: Line;
}

export class PointSnapEventHandler extends SnapEventHandler<PointSnapData> {
    constructor(document: IDocument, controller: AsyncController, pointData: PointSnapData) {
        super(document, controller, [], pointData);
        this.snaps.push(...this.getInitSnaps(pointData));
    }

    protected getInitSnaps(pointData: PointSnapData): ISnap[] {
        const objectSnap = new ObjectSnap(Config.instance.snapType, pointData.refPoint);
        const workplaneSnap = pointData.plane
            ? new PlaneSnap(pointData.plane, pointData.refPoint)
            : new WorkplaneSnap(pointData.refPoint);
        const trackingSnap = new TrackingSnap(pointData.refPoint, true);
        const surfaceSnap = new SurfaceSnap();
        return [objectSnap, trackingSnap, surfaceSnap, workplaneSnap];
    }

    protected getPointFromInput(view: IView, text: string): SnapResult {
        const { values, absolute } = parseDimensionInput(text);
        const refPoint = this.getRefPoint() ?? XYZ.zero;
        const result: SnapResult = { point: refPoint, view, shapes: [], type: "input" };

        if (absolute) {
            result.point = new XYZ({ x: values[0], y: values[1], z: values[2] });
        } else if (values.length === 1 && this._snaped?.point) {
            result.point = this.calculatePointFromDistance(refPoint, values[0]);
        } else if (values.length > 1) {
            result.point = this.calculatePointFromCoordinates(refPoint, values);
        }

        return result;
    }

    private calculatePointFromDistance(refPoint: XYZ, distance: number): XYZ {
        const vector = this._snaped!.point!.sub(refPoint).normalize()!;
        return refPoint.add(vector.multiply(distance));
    }

    private calculatePointFromCoordinates(refPoint: XYZ, dims: number[]): XYZ {
        const plane = this.data.plane?.() ?? this.snaped!.view.workplane;
        // one offset per axis there is: the plane has three, and a number with no axis to go on
        // is dropped rather than thrown on, as it was before the offsets began carrying a side
        const axes = [plane.xvec, plane.yvec, plane.normal].slice(0, dims.length);
        return axes.reduce((point, axis, index) => {
            const value = this.followSnapedSign(refPoint, axis, dims[index]);
            return point.add(axis.multiply(value));
        }, refPoint);
    }

    protected inputError(text: string): I18nKeys | undefined {
        const { values, absolute } = parseDimensionInput(text);
        const dimension = DimensionUtils.from(values.length);

        if (absolute && values.length !== 3) return "error.input.threeNumberCanBeInput";
        if (!this.isValidDimension(dimension)) return "error.input.unsupportedInputs";
        if (this.hasInvalidNumbers(values)) return "error.input.invalidNumber";
        if (this.requiresThreeNumbers(values)) return "error.input.threeNumberCanBeInput";
        if (this.isInvalidSingleNumber(values)) return "error.input.cannotInputANumber";

        return undefined;
    }

    private isValidDimension(dimension: Dimension): boolean {
        return DimensionUtils.contains(this.data.dimension!, dimension);
    }

    private hasInvalidNumbers(dims: number[]): boolean {
        return dims.some(Number.isNaN);
    }

    private requiresThreeNumbers(dims: number[]): boolean {
        const refPoint = this.getRefPoint();
        return refPoint === undefined && dims.length !== 3;
    }

    private isInvalidSingleNumber(dims: number[]): boolean {
        const refPoint = this.getRefPoint();
        return dims.length === 1 && refPoint! && (!this._snaped || this._snaped.point!.isEqualTo(refPoint));
    }

    private getRefPoint(): XYZ | undefined {
        return this.data.refPoint?.() ?? this._snaped?.refPoint;
    }
}

export class SnapPointOnCurveEventHandler extends SnapEventHandler<SnapPointOnCurveData> {
    constructor(document: IDocument, controller: AsyncController, pointData: SnapPointOnCurveData) {
        const objectSnap = new ObjectSnap(Config.instance.snapType);
        const snap = new PointOnCurveSnap(pointData);
        const surfaceSnape = new SurfaceSnap();
        const workplaneSnap = new WorkplaneSnap();
        super(document, controller, [objectSnap, snap, surfaceSnape, workplaneSnap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const length = this.data.curve.length();
        const parameter = Number(text) / length;
        return { point: this.data.curve.value(parameter), view, shapes: [], type: "input" };
    }

    protected override inputError(text: string) {
        return Number.isNaN(Number(text)) ? "error.input.invalidNumber" : undefined;
    }
}

export class SnapPointOnAxisEventHandler extends SnapEventHandler<SnapPointOnAxisData> {
    constructor(document: IDocument, controller: AsyncController, pointData: SnapPointOnAxisData) {
        const objectSnap = new ObjectSnap(Config.instance.snapType);
        const snap = new AxisSnap(pointData.ray.point, pointData.ray.direction);
        super(document, controller, [objectSnap, snap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const dist = this.calculateDistance(Number(text));
        const point = this.data.ray.point.add(this.data.ray.direction.multiply(dist));
        return { point, view, shapes: [], type: "input" };
    }

    protected calculateDistance(inputValue: number): number {
        return this.isSnapedOnNegativeSide() ? -inputValue : inputValue;
    }

    protected isSnapedOnNegativeSide() {
        return (
            this._snaped?.point !== undefined &&
            this._snaped.point.sub(this.data.ray.point).dot(this.data.ray.direction) < -Precision.Distance
        );
    }

    protected override inputError(text: string) {
        return Number.isNaN(Number(text)) ? "error.input.invalidNumber" : undefined;
    }
}

export class SnapPointPlaneEventHandler extends PointSnapEventHandler {
    protected override getInitSnaps(pointData: PointSnapData): ISnap[] {
        if (!pointData.plane) throw new Error("plane is required");

        return [new ObjectSnap(Config.instance.snapType), new PlaneSnap(pointData.plane)];
    }

    protected override findSnapPoint(shapeType: ShapeType, view: IView, event: PointerEvent): void {
        super.findSnapPoint(shapeType, view, event);

        if (this._snaped?.point) {
            // Re-evaluating the plane at the snapped point keeps this a fixed point
            // for plane callbacks whose result depends on the pick position.
            this._snaped.point = this.data.plane!(this._snaped.point).project(this._snaped.point);
        }
    }
}
