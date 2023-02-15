// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, IShape, XYZ } from "chili-core";
import { Application } from "../application";
import { LineBody } from "../bodys";
import { EditorEventHandler, FeaturePoint } from "./eventHandler";

export class LineEditorEventHandler extends EditorEventHandler {
    constructor(document: IDocument, readonly line: LineBody) {
        super(document);
    }

    featurePoints(): FeaturePoint[] {
        return [
            {
                point: this.line.start,
                tip: "line.start",
                preview: (x) => this.linePreview(x, this.line.end),
                setter: (p) => (this.line.start = p),
            },
            {
                point: this.line.end,
                tip: "line.end",
                preview: (x) => this.linePreview(this.line.start, x),
                setter: (p) => (this.line.end = p),
            },
        ];
    }

    private linePreview = (s: XYZ, e: XYZ): IShape => {
        return Application.instance.shapeFactory.line(s, e).value!;
    };
}
