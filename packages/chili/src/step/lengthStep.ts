// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { AsyncController, IDocument, Precision, XYZ } from "chili-core";
import {
    LengthAtAxisSnapData,
    SnapLengthAtAxisHandler,
    SnapLengthAtPlaneData,
    SnapLengthAtPlaneHandler,
} from "../snap";
import { SnapStep } from "./step";

export class LengthAtAxisStep extends SnapStep<LengthAtAxisSnapData> {
    protected getEventHandler(document: IDocument, controller: AsyncController, data: LengthAtAxisSnapData) {
        return new SnapLengthAtAxisHandler(document, controller, data);
    }

    protected validator(data: LengthAtAxisSnapData, point: XYZ): boolean {
        return Math.abs(point.sub(data.point).dot(data.direction)) > Precision.Distance;
    }
}

export class LengthAtPlaneStep extends SnapStep<SnapLengthAtPlaneData> {
    protected getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: SnapLengthAtPlaneData,
    ) {
        return new SnapLengthAtPlaneHandler(document, controller, data);
    }

    protected validator(data: SnapLengthAtPlaneData, point: XYZ): boolean {
        const pointAtPlane = data.plane(point).project(point);
        return pointAtPlane.distanceTo(data.point()) > Precision.Distance;
    }
}
