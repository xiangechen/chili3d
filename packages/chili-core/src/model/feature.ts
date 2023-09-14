// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IShape } from "../geometry";
import { Entity } from "./entity";

export abstract class Feature extends Entity {
    origin: IShape | undefined;
}
