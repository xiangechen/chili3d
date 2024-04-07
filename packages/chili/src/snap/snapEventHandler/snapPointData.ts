// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Plane, XYZ } from "chili-core";
import { Dimension } from "../dimension";
import { SnapPreviewer, SnapValidator, SnapedData } from "../interfaces";

export interface SnapPointData {
    dimension?: Dimension;
    refPoint?: () => XYZ;
    validators?: SnapValidator[];
    preview?: SnapPreviewer;
    prompt?: (point: SnapedData) => string;
    plane?: () => Plane;
    featurePoints?: {
        point: XYZ;
        prompt: string;
        when?: () => boolean;
    }[];
}
