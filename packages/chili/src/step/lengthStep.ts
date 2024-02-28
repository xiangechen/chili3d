// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Precision, XYZ } from "chili-core";
import {
    LengthAtAxisSnapper,
    LengthAtPlaneSnapper,
    SnapLengthAtAxisData,
    SnapLengthAtPlaneData,
    Snapper,
} from "../snap";
import { StepBase } from "./step";

export class LengthAtAxisStep extends StepBase<SnapLengthAtAxisData> {
    protected override snapper(data: SnapLengthAtAxisData): Snapper {
        return new LengthAtAxisSnapper(data);
    }

    protected validator(data: SnapLengthAtAxisData, point: XYZ): boolean {
        return Math.abs(point.sub(data.point).dot(data.direction)) > Precision.Distance;
    }
}

export class LengthAtPlaneStep extends StepBase<SnapLengthAtPlaneData> {
    protected override snapper(data: SnapLengthAtPlaneData): Snapper {
        return new LengthAtPlaneSnapper(data);
    }

    protected validator(data: SnapLengthAtPlaneData, point: XYZ): boolean {
        let pointAtPlane = data.plane().project(point);
        return pointAtPlane.distanceTo(data.point()) > Precision.Distance;
    }
}
