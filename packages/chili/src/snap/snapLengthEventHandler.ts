// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, Configure, I18n, IDocument, IView, Plane, Validation, XYZ } from "chili-core";

import { ObjectSnap } from "./objectSnap";
import { PlaneSnap } from "./planeSnap";
import { PreviewFromPoint } from "./shapePreview";
import { SnapEventHandler } from "./snapEventHandler";
import { AxisTracking } from "./tracking";

export interface SnapLengthAtAxisData {
    tip: keyof I18n;
    point: XYZ;
    direction: XYZ;
    validator?: (view: IView, point: XYZ) => boolean;
    preview: PreviewFromPoint;
}

export interface SnapLengthAtPlaneData {
    tip: keyof I18n;
    point: XYZ;
    plane: Plane;
    validator?: (view: IView, point: XYZ) => boolean;
    preview: PreviewFromPoint;
}

export class SnapLengthAtAxisHandler extends SnapEventHandler {
    constructor(cancellationToken: CancellationToken, readonly data: SnapLengthAtAxisData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let axisTracking = new AxisTracking(data.point, data.direction);
        super(cancellationToken, [objectSnap, axisTracking], [], data.validator);
    }

    protected preview(view: IView, point: XYZ) {
        return this.data?.preview(view, point);
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        return this.data.point.add(this.data.direction.multiply(Number(text)));
    }

    protected isValidInput(text: string) {
        let n = Number(text);
        if (Number.isNaN(n)) return Validation.error("error.input.invalidNumber");
        return Validation.ok();
    }
}

export class SnapLengthAtPlaneHandler extends SnapEventHandler {
    constructor(cancellationToken: CancellationToken, readonly data: SnapLengthAtPlaneData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let planeSnap = new PlaneSnap(data.plane);
        super(cancellationToken, [objectSnap, planeSnap], [], data.validator);
    }

    protected preview(view: IView, point: XYZ) {
        return this.data?.preview(view, point);
    }

    protected getPointFromInput(view: IView, text: string): XYZ {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.length === 1) {
            let vector = this._snaped?.point.sub(this.data.point).normalize();
            return this.data.point.add(vector!.multiply(ns[0]));
        }
        return this.data.point.add(this.data.plane.x.multiply(ns[0])).add(this.data.plane.y.multiply(ns[1]));
    }

    protected isValidInput(text: string) {
        let ns = text.split(",").map((x) => Number(x));
        if (ns.some((x) => Number.isNaN(x))) return Validation.error("error.input.invalidNumber");
        if (ns.length !== 1 && ns.length !== 2) {
            return Validation.error("error.input.invalidNumber");
        }
        return Validation.ok();
    }
}
