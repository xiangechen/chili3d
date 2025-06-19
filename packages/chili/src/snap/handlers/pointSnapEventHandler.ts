// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    Config,
    I18nKeys,
    ICurve,
    IDocument,
    IView,
    Plane,
    XYZ
} from "chili-core";
import { Dimension } from "../dimension";
import { ISnap, SnapData, SnapResult } from "../snap";
import { ObjectSnap, PlaneSnap, PointOnCurveSnap, WorkplaneSnap } from "../snaps";
import { TrackingSnap } from "../tracking";
import { SnapEventHandler } from "./snapEventHandler";

export interface PointSnapData extends SnapData {
    dimension?: Dimension;
    refPoint?: () => XYZ;
    plane?: () => Plane;
}

export interface SnapPointOnCurveData extends PointSnapData {
    curve: ICurve;
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
        return [objectSnap, trackingSnap, workplaneSnap]
    }

    protected getPointFromInput(view: IView, text: string): SnapResult {
        const [dims, isAbsolute] = this.parseInputDimensions(text);
        const refPoint = this.getRefPoint() ?? XYZ.zero;
        const result = { point: refPoint, view, shapes: [] };

        if (isAbsolute) {
            result.point = new XYZ(dims[0], dims[1], dims[2]);
        } else if (dims.length === 1 && this._snaped?.point) {
            result.point = this.calculatePointFromDistance(refPoint, dims[0]);
        } else if (dims.length > 1) {
            result.point = this.calculatePointFromCoordinates(refPoint, dims);
        }

        return result;
    }

    private parseInputDimensions(text: string): [number[], boolean] {
        const isAbsolute = text.startsWith("#");
        if (isAbsolute) {
            text = text.slice(1);
        }
        return [text.split(",").map(Number), isAbsolute];
    }

    private calculatePointFromDistance(refPoint: XYZ, distance: number): XYZ {
        const vector = this._snaped!.point!.sub(refPoint).normalize()!;
        return refPoint.add(vector.multiply(distance));
    }

    private calculatePointFromCoordinates(refPoint: XYZ, dims: number[]): XYZ {
        const plane = this.data.plane?.() ?? this.snaped!.view.workplane;
        let point = refPoint.add(plane.xvec.multiply(dims[0])).add(plane.yvec.multiply(dims[1]));
        if (dims.length === 3) {
            point = point.add(plane.normal.multiply(dims[2]));
        }
        return point;
    }

    protected inputError(text: string): I18nKeys | undefined {
        const [dims, isAbsolute] = this.parseInputDimensions(text);
        const dimension = Dimension.from(dims.length);

        if (isAbsolute && dims.length !== 3) return "error.input.threeNumberCanBeInput";
        if (!this.isValidDimension(dimension)) return "error.input.unsupportedInputs";
        if (this.hasInvalidNumbers(dims)) return "error.input.invalidNumber";
        if (this.requiresThreeNumbers(dims)) return "error.input.threeNumberCanBeInput";
        if (this.isInvalidSingleNumber(dims)) return "error.input.cannotInputANumber";

        return undefined;
    }

    private isValidDimension(dimension: Dimension): boolean {
        return Dimension.contains(this.data.dimension!, dimension);
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
        const workplaneSnap = new WorkplaneSnap();
        super(document, controller, [objectSnap, snap, workplaneSnap], pointData);
    }

    protected override getPointFromInput(view: IView, text: string): SnapResult {
        const length = this.data.curve.length();
        const parameter = Number(text) / length;
        return { point: this.data.curve.value(parameter), view, shapes: [] };
    }

    protected override inputError(text: string) {
        return Number.isNaN(Number(text)) ? "error.input.invalidNumber" : undefined;
    }
}
