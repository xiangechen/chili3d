// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICurve, Plane, XYZ } from "chili-core";
import { Dimension } from "../dimension";
import { SnapData } from "../snap";

export interface PointSnapData extends SnapData {
    dimension?: Dimension;
    refPoint?: () => XYZ;
    plane?: () => Plane;
}

export interface SnapPointOnCurveData extends PointSnapData {
    curve: ICurve;
}
