// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectSnapType } from "../src";

test("test SnapType", () => {
    let ts = ObjectSnapType.endPoint | ObjectSnapType.midPoint;
    expect(ObjectSnapType.has(ts, ObjectSnapType.center)).toBeFalsy();
    expect(ObjectSnapType.has(ts, ObjectSnapType.midPoint)).toBeTruthy();
});
