// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity } from "./model";

export interface IEditor {
    interact(entity: Entity): boolean;
}
