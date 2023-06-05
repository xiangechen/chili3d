// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Validation } from "./validation";

export interface Executor<T, E> {
    validate(arg: T): Validation<E>;
    execute(arg: T): void;
}
