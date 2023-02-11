// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IEqualityComparer, Precision, XYZ } from "chili-core";

export class XYZEqualityComparer implements IEqualityComparer<XYZ> {
    constructor(readonly tolerance: number = Precision.confusion) {}

    equals(left: XYZ, right: XYZ): boolean {
        return left.isEqualTo(right, this.tolerance);
    }
}
