// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { IHistoryHandler } from "../history";
import { Result } from "../result";
import { IUpdateHandler } from "./updateHandler";

export interface IEditor extends IHistoryHandler, IUpdateHandler {
    edit(shape: IShape): Result<IShape>;
    name(): string;
}
