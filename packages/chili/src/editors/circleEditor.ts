// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IShape, XYZ } from "chili-core";
import { Application } from "../application";
import { CircleBody } from "../bodys";
import { EditorEventHandler, FeaturePoint } from "./eventHandler";

export class CircleEditorEventHandler extends EditorEventHandler {
    constructor(document: IDocument, readonly circle: CircleBody) {
        super(document);
    }

    featurePoints(): FeaturePoint[] {
        let x = XYZ.unitX;
        if (x.isParallelTo(this.circle.normal)) x = XYZ.unitY;
        let vec = this.circle.normal.cross(x).normalize()!.multiply(this.circle.radius);
        let radiusPoint = this.circle.center.add(vec);
        return [
            {
                point: this.circle.center,
                tip: "circle.center",
                preview: (x) => this.circlePreview(x, this.circle.radius),
                setter: (p) => (this.circle.center = p),
            },
            {
                point: radiusPoint,
                tip: "circle.radius",
                preview: (x) => this.circlePreview(this.circle.center, this.circle.center.distanceTo(x)),
                setter: (p) => (this.circle.radius = p.distanceTo(this.circle.center)),
            },
        ];
    }

    private circlePreview = (c: XYZ, r: number): IShape => {
        return Application.instance.shapeFactory.circle(this.circle.normal, c, r).value!;
    };
}
