// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { ObjectSnapType } from "../src";

test("test SnapType", () => {
    let ts = ObjectSnapType.endPoint | ObjectSnapType.midPoint;
    expect(ObjectSnapType.has(ts, ObjectSnapType.center)).toBeFalsy();
    expect(ObjectSnapType.has(ts, ObjectSnapType.midPoint)).toBeTruthy();
});
