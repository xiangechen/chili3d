// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "chili-shared";
import { IShape } from "./shape";

export interface IEditor {
    edit(shape: IShape): Result<IShape>;
    name(): string;
}
