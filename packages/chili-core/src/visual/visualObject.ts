// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable, Matrix4 } from "chili-core";

export interface IVisualObject extends IDisposable {
    visible: boolean;
    transform: Matrix4;
}
