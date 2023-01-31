// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CancellationToken, Configure, IView, Validation, XYZ } from "chili-core";

import { SnapedData } from "./interfaces";
import { ObjectSnap } from "./objectSnap";
import { ShapeFromLength } from "./shapeFromPoint";
import { SnapEventHandlerBase } from "./snapEventHandlerBase";
import { AxisTracking } from "./tracking";

export interface SnapLengthData {
    point: XYZ;
    direction: XYZ;
    validator?: (view: IView, point: XYZ) => boolean;
    shapeCreator?: ShapeFromLength;
}

export class SnapLengthEventHandler extends SnapEventHandlerBase {
    constructor(cancellationToken: CancellationToken, readonly data: SnapLengthData) {
        let objectSnap = new ObjectSnap(Configure.current.snapType);
        let axisTracking = new AxisTracking(data.point, data.direction);
        super(cancellationToken, [objectSnap, axisTracking], []);
    }

    protected isValid(view: IView, snaped: SnapedData): boolean {
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

    protected getInput(view: IView, text: string): XYZ {
        return this.data.point.add(this.data.direction.multiply(Number(text)));
    }

    protected handleValid(text: string) {
        let n = Number(text);
        if (Number.isNaN(n)) return Validation.error("error.input.invalidNumber");
        return Validation.ok();
    }
}
