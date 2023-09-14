// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ObjectSnapType } from "../src";

test("test SnapType", () => {
    let ts = ObjectSnapType.endPoint | ObjectSnapType.midPoint;
    expect(ObjectSnapType.has(ts, ObjectSnapType.center)).toBeFalsy();
    expect(ObjectSnapType.has(ts, ObjectSnapType.midPoint)).toBeTruthy();
});
