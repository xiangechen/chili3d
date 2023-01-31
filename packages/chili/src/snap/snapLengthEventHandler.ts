// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, Configure, IView, Plane, Validation, XYZ } from "chili-core";

import { SnapedData } from "./interfaces";
import { ObjectSnap } from "./objectSnap";
import { PlaneSnap } from "./planeSnap";
import { ShapeFromLength } from "./shapeFromPoint";
import { SnapEventHandlerBase } from "./snapEventHandlerBase";
import { AxisTracking } from "./tracking";

export interface SnapLengthAtAxisData {
    point: XYZ;
    direction: XYZ;
    validator?: (view: IView, point: XYZ) => boolean;
    shapeCreator?: ShapeFromLength;
}

export interface SnapLengthAtPlaneData {
    point: XYZ;
    plane: Plane;
    validator?: (view: IView, point: XYZ) => boolean;
    shapeCreator?: ShapeFromLength;
}

export class SnapLengthAtAxisHandler extends SnapEventHandlerBase {
    constructor(cancellationToken: CancellationToken, readonly data: SnapLengthAtAxisData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let axisTracking = new AxisTracking(data.point, data.direction);
        super(cancellationToken, [objectSnap, axisTracking], []);
    }

    protected isValidSnap(view: IView, snaped: SnapedData): boolean {
        return this.data.validator === undefined || this.data.validator(view, snaped.point);
    }

    protected createTempShape(view: IView, point: XYZ): number | undefined {
        if (this.data.shapeCreator === undefined) return undefined;
        let length = point.sub(this.data.point).dot(this.data.direction);
        let shape = this.data
            .shapeCreator(view, length)
            ?.mesh()
            .edges.map((x) => x.renderData);
        if (shape === undefined) return undefined;
        return view.document.visualization.context.temporaryDisplay(...shape);
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

export class SnapLengthAtPlaneHandler extends SnapEventHandlerBase {
    constructor(cancellationToken: CancellationToken, readonly data: SnapLengthAtPlaneData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let planeSnap = new PlaneSnap(data.plane);
        super(cancellationToken, [objectSnap, planeSnap], []);
    }

    protected isValidSnap(view: IView, snaped: SnapedData): boolean {
        return this.data.validator === undefined || this.data.validator(view, snaped.point);
    }

    protected createTempShape(view: IView, point: XYZ): number | undefined {
        if (this.data.shapeCreator === undefined) return undefined;
        let length = this.data.point.distanceTo(point);
        let shape = this.data
            .shapeCreator(view, length)
            ?.mesh()
            .edges.map((x) => x.renderData);
        if (shape === undefined) return undefined;
        return view.document.visualization.context.temporaryDisplay(...shape);
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
