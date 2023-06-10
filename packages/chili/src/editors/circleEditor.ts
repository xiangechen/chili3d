// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IShape, Plane, XYZ } from "chili-core";
import { Application } from "chili-core/src/application";
import { CircleBody } from "../bodys";
import { Dimension, LengthAtPlaneSnapper, PointSnapper, Snapper } from "../snap";
import { EditorEventHandler, FeaturePoint } from "./eventHandler";

export class CircleEditorEventHandler extends EditorEventHandler {
    private xVector: XYZ;
    protected points: FeaturePoint[];
    constructor(document: IDocument, readonly circle: CircleBody) {
        super(document);
        this.xVector = this.getXVector();
        this.points = this.getFeaturePoints();
    }

    private getXVector(): XYZ {
        let x = XYZ.unitX;
        if (x.isParallelTo(this.circle.normal)) x = XYZ.unitY;
        return this.circle.normal.cross(x).normalize()!;
    }

    protected getSnapper(point: FeaturePoint): Snapper {
        if (point.tip === "circle.center")
            return new PointSnapper({
                refPoint: point.point,
                preview: point.preview,
                dimension: Dimension.D1D2D3,
            });
        return new LengthAtPlaneSnapper({
            point: point.point,
            plane: new Plane(point.point, this.circle.normal, this.xVector),
            preview: point.preview,
        });
    }

    getFeaturePoints(): FeaturePoint[] {
        let radiusPoint = this.getRadiusPoint();
        return [
            {
                point: this.circle.center,
                tip: "circle.center",
                preview: (x) => this.circlePreview(x, this.circle.radius),
                setter: this.setCenter,
                displayed: this.showPoint(this.circle.center),
            },
            {
                point: radiusPoint,
                tip: "circle.radius",
                preview: (x) => this.circlePreview(this.circle.center, this.circle.center.distanceTo(x)),
                setter: (p) => (this.circle.radius = p.distanceTo(this.circle.center)),
                displayed: this.showPoint(radiusPoint),
            },
        ];
    }

    private setCenter = (center: XYZ) => {
        this.circle.center = center;
        let radiusPoint = this.getRadiusPoint();
        this.setNewPoint(this.points[1], radiusPoint);
    };

    private circlePreview = (c: XYZ, r: number) => {
        return [Application.instance.shapeFactory.circle(this.circle.normal, c, r).value!.mesh().edges!];
    };

    private getRadiusPoint() {
        let vec = this.xVector.multiply(this.circle.radius);
        let radiusPoint = this.circle.center.add(vec);
        return radiusPoint;
    }
}
