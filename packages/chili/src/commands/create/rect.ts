// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { GeometryModel, MathUtils, Plane, Property, XYZ, command } from "chili-core";
import { RectBody } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand, CreateFaceableCommand } from "./createCommand";

export interface RectData {
    plane: Plane;
    dx: number;
    dy: number;
    p1: XYZ;
    p2: XYZ;
}

export namespace RectData {
    export function get(atPlane: Plane, start: XYZ, end: XYZ): RectData {
        let plane = new Plane(start, atPlane.normal, atPlane.xvec);
        let vector = end.sub(start);
        let dx = vector.dot(plane.xvec);
        let dy = vector.dot(plane.yvec);
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
            plane: this.stepDatas[0].view.workplane.translateTo(point),
            validators: [this.handleValid],
        };
    };

    private handleValid = (end: XYZ) => {
        let data = this.getRectData(end);
        if (data === undefined) return false;
        return !MathUtils.anyEqualZero(data.dx, data.dy);
    };

    private previewRect = (end: XYZ) => {
        let data = this.getRectData(end);
        return [this.application.shapeFactory.rect(data.plane, data.dx, data.dy).unwrap().mesh.edges!];
    };

    protected getRectData(point: XYZ): RectData {
        let [p1, p2] = [this.stepDatas[0].point, point];
        return RectData.get(this.stepDatas[0].view.workplane, p1, p2);
    }
}

@command({
    name: "create.rect",
    display: "command.rect",
    icon: "icon-rect",
})
export class Rect extends RectCommandBase {
    private static count: number = 1;

    protected _isFace: boolean = false;
    @Property.define("command.faceable.isFace")
    public get isFace() {
        return this._isFace;
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }

    protected create(): GeometryModel {
        let rect = this.getRectData(this.stepDatas[1].point);
        let body = new RectBody(this.document, rect.plane, rect.dx, rect.dy);
        body.isFace = this._isFace;
        return new GeometryModel(this.document, `Rect ${Rect.count++}`, body);
    }
}
