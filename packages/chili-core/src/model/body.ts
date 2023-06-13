// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Matrix4 } from "../math";
import { Entity } from "./entity";

export abstract class Body extends Entity {
    abstract setMatrix(matrix: Matrix4): void;
}
