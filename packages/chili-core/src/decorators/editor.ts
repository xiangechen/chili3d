// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEditor } from "../editor";
import { Entity } from "../model";

export function editor(E: new () => IEditor) {
    return (ctor: new (...args: any[]) => Entity) => {};
}
