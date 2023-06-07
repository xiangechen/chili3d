// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { IVisualShape } from "./visualShape";

export interface VisualShapeData {
    shape: IShape;
    owner: IVisualShape;
    index?: number;
}
