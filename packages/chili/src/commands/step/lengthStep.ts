// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IDocument, IView, Plane, Precision, XYZ } from "chili-core";

import { Snapper } from "../../snap";
import { ShapeFromLength } from "../../snap/shapeFromPoint";
import { IStep } from "./step";

export class LengthAtAxisStep implements IStep<number> {
    constructor(readonly point: XYZ, readonly direnction: XYZ, readonly handleTemp: ShapeFromLength) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<number | undefined> {
        let snap = new Snapper(document);
        return await snap.snapLengthAtAxisAsync(tip, {
            point: this.point,
            direction: this.direnction,
            validator: this.handleValid,
            shapeCreator: this.handleTemp,
        });
    }

    private handleValid = (view: IView, end: XYZ) => {
        return Math.abs(end.sub(this.point).dot(this.direnction)) > Precision.confusion;
    };
}

export class LengthAtPlaneStep implements IStep<number> {
    constructor(readonly point: XYZ, readonly plane: Plane, readonly handleTemp: ShapeFromLength) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<number | undefined> {
        let snap = new Snapper(document);
        return await snap.snapLengthAtPlaneAsync(tip, {
            point: this.point,
            plane: this.plane,
            validator: this.handleValid,
            shapeCreator: this.handleTemp,
        });
    }

    private handleValid = (view: IView, end: XYZ) => {
        let point = this.plane.project(end);
        return point.distanceTo(this.point) > 0;
    };
}
