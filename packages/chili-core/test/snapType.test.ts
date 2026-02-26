// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectSnapType, ObjectSnapTypeUtils } from "../src";

test("test SnapType", () => {
    const ts = ObjectSnapType.endPoint | ObjectSnapType.midPoint;
    expect(ObjectSnapTypeUtils.hasType(ts, ObjectSnapType.center)).toBeFalsy();
    expect(ObjectSnapTypeUtils.hasType(ts, ObjectSnapType.midPoint)).toBeTruthy();
});
