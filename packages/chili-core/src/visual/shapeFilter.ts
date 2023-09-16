// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IShape } from "../geometry";

export interface IShapeFilter {
    allow(shape: IShape): boolean;
}
