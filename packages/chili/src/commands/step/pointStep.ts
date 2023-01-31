// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IDocument, IView, XYZ } from "chili-core";

import { Dimension, Snapper } from "../../snap";
import { ShapeFromLength, ShapeFromPoint } from "../../snap/shapeFromPoint";
import { IStep } from "./step";

export class AnyPointStep implements IStep<XYZ> {
    async perform(document: IDocument, tip: keyof I18n): Promise<XYZ | undefined> {
        let snap = new Snapper(document);
        return await snap.snapPointAsync(tip, { dimension: Dimension.D1D2D3 });
    }
}

export class PointStep implements IStep<XYZ> {
    constructor(readonly first: XYZ, readonly dimension: Dimension, readonly handleTemp: ShapeFromPoint) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<XYZ | undefined> {
        let snap = new Snapper(document);
        return await snap.snapPointAsync(tip, {
            dimension: this.dimension,
            refPoint: this.first,
            validator: this.handleValid,
            shapeCreator: this.handleTemp,
        });
    }

    private handleValid = (view: IView, end: XYZ) => {
        return !this.first.isEqualTo(end);
    };
}

export class LengthStep implements IStep<number> {
    constructor(readonly point: XYZ, readonly direnction: XYZ, readonly handleTemp: ShapeFromLength) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<number | undefined> {
        let snap = new Snapper(document);
        return await snap.snapLengthAsync(tip, {
            point: this.point,
            direction: this.direnction,
            validator: this.handleValid,
            shapeCreator: this.handleTemp,
        });
    }

    private handleValid = (view: IView, end: XYZ) => {
        return !this.point.isEqualTo(end);
    };
}
