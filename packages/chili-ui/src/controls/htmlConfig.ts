// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding } from "./binding";
import { Localize } from "./localize";

export type HTMLConfig<T> = {
    [P in keyof T]?: T[P] extends object
        ? HTMLConfig<T[P]>
        : (T[P] | Binding) | (P extends "textContent" ? Localize : never);
};
