// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, IDocument, Precision, XYZ } from "chili-core";
import {
    LengthAtAxisSnapData,
    SnapLengthAtAxisHandler,
    SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
} from "../snap";
import { Step } from "./step";

export class LengthAtAxisStep extends Step<LengthAtAxisSnapData> {
    protected getEventHandler(document: IDocument, controller: AsyncController) {
        return new SnapLengthAtAxisHandler(document, controller, this.handleStepData());
    }

    protected validator(data: LengthAtAxisSnapData, point: XYZ): boolean {
        return Math.abs(point.sub(data.point).dot(data.direction)) > Precision.Distance;
    }
}

export class LengthAtPlaneStep extends Step<SnapLengthAtPlaneData> {
    protected getEventHandler(document: IDocument, controller: AsyncController) {
        return new SnapLengthAtPlaneHandler(document, controller, this.handleStepData());
    }

    protected validator(data: SnapLengthAtPlaneData, point: XYZ): boolean {
        let pointAtPlane = data.plane().project(point);
        return pointAtPlane.distanceTo(data.point()) > Precision.Distance;
    }
}
