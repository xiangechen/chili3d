// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Color, IDisposable } from "chili-core";

export interface IVisualObject extends IDisposable {
    visible: boolean;
    color: Color;
    transparency: number;
}
