// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IShape, ShapeMeshData, XYZ } from "chili-core";
import { Application } from "chili-core/src/application";
import { LineBody } from "../bodys";
import { Dimension, PointSnapper, Snapper } from "../snap";
import { EditorEventHandler, FeaturePoint } from "./eventHandler";

export class LineEditorEventHandler extends EditorEventHandler {
    protected points: FeaturePoint[];

    constructor(document: IDocument, readonly line: LineBody) {
        super(document);
        this.points = this.getFeaturePoints();
    }

    protected getSnapper(point: FeaturePoint): Snapper {
        return new PointSnapper({
            dimension: Dimension.D1D2D3,
            refPoint: point.point,
            preview: point.preview,
        });
    }

    private getFeaturePoints(): FeaturePoint[] {
        return [
            {
                point: this.line.start,
                tip: "line.start",
                preview: (x) => this.linePreview(x, this.line.end),
                setter: (point) => (this.line.start = point),
                displayed: this.showPoint(this.line.start),
            },
            {
                point: this.line.end,
                tip: "line.end",
                preview: (x) => this.linePreview(this.line.start, x),
                setter: (p) => (this.line.end = p),
                displayed: this.showPoint(this.line.end),
            },
        ];
    }

    private linePreview = (s: XYZ, e: XYZ) => {
        return [Application.instance.shapeFactory.line(s, e).value!.mesh().edges!];
    };
}
