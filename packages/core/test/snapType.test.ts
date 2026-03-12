// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "../src";

test("test SnapType", () => {
    const ts = (ObjectSnapTypes.endPoint | ObjectSnapTypes.midPoint) as ObjectSnapType;
    expect(ObjectSnapTypeUtils.hasType(ts, ObjectSnapTypes.center)).toBeFalsy();
    expect(ObjectSnapTypeUtils.hasType(ts, ObjectSnapTypes.midPoint)).toBeTruthy();
});
