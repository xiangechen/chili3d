// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IEqualityComparer, Precision, XYZ } from "chili-core";

export class XYZEqualityComparer implements IEqualityComparer<XYZ> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: XYZ, right: XYZ): boolean {
        return left.isEqualTo(right, this.tolerance);
    }
}
