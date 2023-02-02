// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { I18n, IDocument, IView, XYZ } from "chili-core";

import { Dimension, SnapedData, Snapper } from "../../snap";
import { ShapeFromPoint } from "../../snap/shapeCreator";
import { IStep } from "./step";

export class AnyPointStep implements IStep<SnapedData> {
    constructor(readonly handleTempShape?: ShapeFromPoint) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<SnapedData | undefined> {
        let snap = new Snapper(document);
        return await snap.snapPointAsync(tip, { dimension: Dimension.D1D2D3, shapeCreator: this.handleTempShape });
    }
}

export class PointStep implements IStep<XYZ> {
    constructor(readonly first: XYZ, readonly dimension: Dimension, readonly handleTemp: ShapeFromPoint) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<XYZ | undefined> {
        let snap = new Snapper(document);
        return await snap
            .snapPointAsync(tip, {
                dimension: this.dimension,
                refPoint: this.first,
                validator: this.handleValid,
                shapeCreator: this.handleTemp,
            })
            .then((x) => x?.point);
    }

    private handleValid = (view: IView, end: XYZ) => {
        return !this.first.isEqualTo(end);
    };
}
