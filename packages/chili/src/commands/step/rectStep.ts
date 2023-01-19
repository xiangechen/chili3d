// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Dimension, IDocument, Snapper } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Container, I18n, MathUtils, Plane, Result, Token, XYZ } from "chili-shared";
import { IView } from "chili-vis";
import { IStep } from "./step";

export interface RectData {
    plane: Plane;
    dx: number;
    dy: number;
    p1: XYZ;
    p2: XYZ;
}

export class RectStep implements IStep<RectData> {
    constructor(readonly first: XYZ) {}

    async perform(document: IDocument, tip: keyof I18n): Promise<RectData | undefined> {
        let view: IView | undefined = undefined;
        let snap = new Snapper(document);
        let point = await snap.snapPointAsync(tip, {
            dimension: Dimension.D1D2,
            refPoint: this.first,
            valid: (v, p) => this.handleValid(v, this.first, p),
            tempShape: (v, p) => {
                view = v;
                return this.handleTempRect(v, this.first, p);
            },
        });
        if (point === undefined || view === undefined) return undefined;
        let data = this.getRectData(view, this.first, point)!;
        return data;
    }

    private handleValid = (view: IView, start: XYZ, end: XYZ) => {
        let data = this.getRectData(view, start, end);
        if (data === undefined) return false;
        return !MathUtils.anyEqualZero(data.dx, data.dy);
    };

    private handleTempRect = (view: IView, start: XYZ, end: XYZ) => {
        let data = this.getRectData(view, start, end)!;
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory?.rect(data.plane, data.dx, data.dy).value;
    };

    private getRectData(view: IView, start: XYZ, end: XYZ) {
        if (start.isEqualTo(end)) return undefined;
        let plane = new Plane(start, view.workplane.normal, view.workplane.x);
        let vector = end.sub(start);
        let dx = vector.dot(plane.x);
        let dy = vector.dot(plane.y);
        return { plane, dx, dy, p1: start, p2: end };
    }
}
