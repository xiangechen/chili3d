// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Id, IDocument, Model } from "chili-core";
import { IBody, IShape, ISolid } from "chili-geo";
import { OccShape } from "chili-occ/src/occShape";

export class BoxBody implements IBody {
    constructor(readonly x: number, readonly y: number) {}

    body(): IShape | undefined {
        let make = new occ.BRepPrimAPI_MakeBox_3(new occ.gp_Pnt_3(this.x, this.y, 0), 10, 10, 10);
        return new OccShape(make.Shape());
    }
}

export function addBox(document: IDocument, name: string, x: number, y: number) {
    let model = new Model(document, name, Id.new(), new BoxBody(x, y));
    document.addModel(model);
}
