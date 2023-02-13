// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Entity, IEditor } from "chili-core";

export class DefaultEditor implements IEditor {
    interact(entity: Entity): boolean {
        return true;
    }
}
