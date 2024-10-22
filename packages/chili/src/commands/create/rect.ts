// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { GeometryNode, MathUtils, Plane, Property, XYZ, command } from "chili-core";
import { RectNode } from "../../bodys";
import { SnapLengthAtPlaneData, SnapedData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

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

    private readonly nextSnapData = (): SnapLengthAtPlaneData => {
        return {
            point: () => this.stepDatas[0].point!,
            preview: this.previewRect,
            plane: () => this.stepDatas[0].view.workplane.translateTo(this.stepDatas[0].point!),
            validators: [this.handleValid],
            prompt: (snaped: SnapedData) => {
                let data = this.getRectData(snaped.point!);
                return `${data.dx.toFixed(2)}, ${data.dy.toFixed(2)}`;
            },
        };
    };

    private readonly handleValid = (end: XYZ) => {
        let data = this.getRectData(end);
        if (data === undefined) return false;
        return !MathUtils.anyEqualZero(data.dx, data.dy);
    };

    protected previewRect = (end: XYZ | undefined) => {
        let p1 = this.previewPoint(this.stepDatas[0].point!);
        if (end === undefined) {
            return [p1];
        }
        let data = this.getRectData(end);
        let p2 = this.previewPoint(end);
        return [p1, p2, this.application.shapeFactory.rect(data.plane, data.dx, data.dy).value.mesh.edges!];
    };

    protected getRectData(point: XYZ): RectData {
        let [p1, p2] = [this.stepDatas[0].point!, point];
        return RectData.get(this.stepDatas[0].view.workplane, p1, p2);
    }
}

@command({
    name: "create.rect",
    display: "command.rect",
    icon: "icon-rect",
})
export class Rect extends RectCommandBase {
    @Property.define("command.faceable.isFace")
    public get isFace() {
        return this.getPrivateValue("isFace", false);
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }

    protected override geometryNode(): GeometryNode {
        let rect = this.getRectData(this.stepDatas[1].point!);
        let node = new RectNode(this.document, rect.plane, rect.dx, rect.dy);
        node.isFace = this.isFace;
        return node;
    }
}
