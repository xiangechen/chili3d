// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Quaternion, XYZ } from "../src";

describe("test Quaternion", () => {
    test("test rotateVector", () => {
        let quat = new Quaternion(0.822363, 0.0222599, 0.43968, 0.360423);
        let vector = new XYZ(0, 1, 0);
        let gtRotVector = new XYZ(-0.573223, 0.739199, 0.353553);
        let afterRotVec = quat.rotateVector(vector);
        expect(afterRotVec.isEqualTo(gtRotVector)).toBeTruthy();
    });
});
