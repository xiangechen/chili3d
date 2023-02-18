// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { command, Container, IDocument, MathUtils, GeometryModel, Plane, Token, XYZ } from "chili-core";
import { IShapeFactory } from "chili-geo";
import { Application } from "../../application";

import { RectBody } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "./createCommand";

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

export abstract class RectCommandBase extends CreateCommand {
    protected getSteps(): IStep[] {
        let first = new PointStep("operate.pickFistPoint");
        let second = new LengthAtPlaneStep("operate.pickNextPoint", this.nextSnapData);
        return [first, second];
    }

    private nextSnapData = (): SnapLengthAtPlaneData => {
        let point = this.stepDatas[0].point;
        return {
            point,
            preview: this.previewRect,
            plane: this.stepDatas[0].view.workplane.copyTo(point),
            validator: this.handleValid,
        };
    };

    private handleValid = (end: XYZ) => {
        let data = this.getRectData(end);
        if (data === undefined) return false;
        return !MathUtils.anyEqualZero(data.dx, data.dy);
    };

    private previewRect = (end: XYZ) => {
        let data = this.getRectData(end);
        return Application.instance.shapeFactory.rect(data.plane, data.dx, data.dy).value;
    };

    protected getRectData(point: XYZ): RectData {
        let [p1, p2] = [this.stepDatas[0].point, point];
        return RectData.get(this.stepDatas[0].view.workplane, p1, p2);
    }
}

@command({
    name: "Rect",
    display: "command.rect",
    icon: "icon-rect",
})
export class Rect extends RectCommandBase {
    protected create(document: IDocument): GeometryModel {
        let rect = this.getRectData(this.stepDatas[1].point);
        let body = new RectBody(rect.plane, rect.dx, rect.dy);
        return new GeometryModel(`Rect ${document.models.count + 1}`, body);
    }

    constructor() {
        super();
    }
}
