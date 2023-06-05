// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "./result";
import { Validation } from "./validation";

export interface Executor<T, E> {
    execute(arg: T): Result<undefined, E>;
}
