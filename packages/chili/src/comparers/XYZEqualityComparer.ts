// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IEqualityComparer, Precision, XYZ } from "chili-core";

export class XYZEqualityComparer implements IEqualityComparer<XYZ> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: XYZ, right: XYZ): boolean {
        return left.isEqualTo(right, this.tolerance);
    }
}
