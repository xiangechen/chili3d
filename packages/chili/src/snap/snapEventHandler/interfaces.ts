// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape, XYZ } from "chili-core";

export interface Validator {
    (point: XYZ): boolean;
}

export interface ShapePreviewer {
    (point: XYZ): IShape | undefined;
}
