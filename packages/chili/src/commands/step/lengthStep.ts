// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Plane, Precision, XYZ } from "chili-core";
import { LengthAtAxisSnapper, LengthAtPlaneSnapper, SnapedData } from "../../snap";
import { SnapLengthAtAxisData, SnapLengthAtPlaneData } from "../../snap/snapLengthEventHandler";
import { IStep } from "./step";

export class LengthAtAxisStep implements IStep {
    constructor(readonly handleData: () => SnapLengthAtAxisData, readonly disableDefaultValidator = false) {}

    async perform(document: IDocument): Promise<SnapedData | undefined> {
        let data = this.handleData();
        if (!this.disableDefaultValidator && data.validator === undefined) {
            data.validator = (v, p) => Math.abs(p.sub(data.point).dot(data.direction)) > Precision.confusion;
        }
        let snapper = new LengthAtAxisSnapper(data);
        return await snapper.snap(document, data.tip);
    }
}

export class LengthAtPlaneStep implements IStep {
    constructor(readonly handleData: () => SnapLengthAtPlaneData, readonly disableDefaultValidator = false) {}

    async perform(document: IDocument): Promise<SnapedData | undefined> {
        let data = this.handleData();
        if (!this.disableDefaultValidator && data.validator === undefined) {
            data.validator = (v, p) => this.handleValid(data.plane, data.point, p);
        }
        let snapper = new LengthAtPlaneSnapper(data);
        return await snapper.snap(document, data.tip);
    }

    private handleValid = (plane: Plane, start: XYZ, end: XYZ) => {
        let point = plane.project(end);
        return point.distanceTo(start) > 0;
    };
}
