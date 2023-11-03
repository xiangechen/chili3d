// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IEqualityComparer, Precision } from "chili-core";

export class NumberEqualityComparer implements IEqualityComparer<number> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: number, right: number): boolean {
        return Math.abs(left - right) < this.tolerance;
    }
}
