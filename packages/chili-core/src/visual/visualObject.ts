// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, Matrix4 } from "chili-core";

export interface IVisualObject {
    visible: boolean;
    color: Color;
    transparency: number;
}
