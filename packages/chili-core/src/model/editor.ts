// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { Result } from "../result";

export interface IEditor {
    edit(shape: IShape): Result<IShape>;
    name(): string;
}
