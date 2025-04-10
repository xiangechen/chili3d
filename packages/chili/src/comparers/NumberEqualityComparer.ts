// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IEqualityComparer, Precision } from "chili-core";

export class NumberEqualityComparer implements IEqualityComparer<number> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: number, right: number): boolean {
        return Math.abs(left - right) < this.tolerance;
    }
}
