// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IShape } from "../geometry";
import { Entity } from "./entity";

export abstract class Editor extends Entity {
    origin: IShape | undefined;
}
