// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IPropertyChanged, PathBinding } from "chili-core";
import { Localize } from "./localize";

export type HTMLProps<T> = {
    [P in keyof T]?: T[P] extends object
        ? HTMLProps<T[P]>
        : (T[P] | PathBinding<IPropertyChanged>) | (P extends "textContent" ? Localize : never);
};
