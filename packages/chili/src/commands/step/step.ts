// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Dimension, IDocument, SnapData, Snapper } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Container, I18n, Plane, Token, XYZ } from "chili-shared";
import { IView } from "chili-vis";

export interface IStep {
    perform(): Promise<XYZ | undefined>;
}

export class PickFirstPoint implements IStep {
    constructor(readonly document: IDocument, readonly tip: keyof I18n) {}

    async perform(): Promise<XYZ | undefined> {
        let snap = new Snapper(this.document);
        return await snap.snapPointAsync(this.tip, { dimension: Dimension.D1D2D3 });
    }
}

export class RectPoint implements IStep {
    constructor(readonly document: IDocument, readonly tip: keyof I18n, readonly first: XYZ) {}

    async perform(): Promise<XYZ | undefined> {
        let snap = new Snapper(this.document);
        return await snap.snapPointAsync(this.tip, { dimension: Dimension.D1D2, refPoint: this.first });
    }

    private handleTempRect = (view: IView, start: XYZ, end: XYZ) => {
        if (start.isEqualTo(end)) return undefined;
        let { plane, dx, dy } = this.getRectData(view, start, end);
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory?.rect(plane, dx, dy).ok();
    };

    private getRectData(view: IView, start: XYZ, end: XYZ) {
        let plane = new Plane(start, view.workplane.normal, view.workplane.x);
        let vector = end.sub(start);
        let dx = vector.dot(plane.x);
        let dy = vector.dot(plane.y);
        return { plane, dx, dy };
    }
}
