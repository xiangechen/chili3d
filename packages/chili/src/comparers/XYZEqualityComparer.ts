// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IEqualityComparer, Precision, XYZ } from "chili-core";

export class XYZEqualityComparer implements IEqualityComparer<XYZ> {
    constructor(readonly tolerance: number = Precision.Distance) {}

    equals(left: XYZ, right: XYZ): boolean {
        return left.isEqualTo(right, this.tolerance);
    }
}
