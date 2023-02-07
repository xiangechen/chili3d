// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Container, I18n, IDocument, IView, MathUtils, Plane, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";

import { Dimension, PointSnapper, SnapedData, SnapPointData } from "../../snap";
import { IStep } from "./step";

export interface RectData {
    plane: Plane;
    dx: number;
    dy: number;
    p1: XYZ;
    p2: XYZ;
}

export namespace RectData {
    export function get(atPlane: Plane, start: XYZ, end: XYZ): RectData {
        let plane = new Plane(start, atPlane.normal, atPlane.x);
        let vector = end.sub(start);
        let dx = vector.dot(plane.x);
        let dy = vector.dot(plane.y);
        return { plane, dx, dy, p1: start, p2: end };
    }
}

export interface RectStepData {
    tip: keyof I18n;
    getFirstPoint: () => XYZ;
    plane: Plane;
}

export class RectStep implements IStep {
    constructor(readonly handleData: () => RectStepData) {}

    async perform(document: IDocument): Promise<SnapedData | undefined> {
        let data = this.handleData();
        let snapper = new PointSnapper({
            tip: data.tip,
            dimension: Dimension.D1D2,
            refPoint: data.getFirstPoint(),
            validator: (v, p) => this.handleValid(data, p),
            preview: (v, p) => this.previewRect(data, p),
            plane: data.plane,
        });
        return await snapper.snap(document, data.tip);
    }

    private handleValid = (stepData: RectStepData, end: XYZ) => {
        let start = stepData.getFirstPoint();
        let data = RectData.get(stepData.plane, start, end);
        if (data === undefined) return false;
        return !MathUtils.anyEqualZero(data.dx, data.dy);
    };

    private previewRect = (stepData: RectStepData, end: XYZ) => {
        let start = stepData.getFirstPoint();
        let data = RectData.get(stepData.plane, start, end)!;
        let factory = Container.default.resolve<IShapeFactory>(Token.ShapeFactory);
        return factory?.rect(data.plane, data.dx, data.dy).value;
    };
}
