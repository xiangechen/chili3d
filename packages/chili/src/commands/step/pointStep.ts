// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { PointSnapper, SnapedData, SnapPointData } from "../../snap";
import { IStep } from "./step";

export class PointStep implements IStep {
    constructor(readonly handleData: () => SnapPointData, readonly disableDefaultValidator = false) {}

    async perform(document: IDocument): Promise<SnapedData | undefined> {
        let data = this.handleData();
        if (!this.disableDefaultValidator && data.validator === undefined && data.refPoint !== undefined) {
            data.validator = (v, p) => data.refPoint!.distanceTo(p) > 0;
        }
        let snapper = new PointSnapper(data);
        return await snapper.snap(document, data.tip);
    }
}
