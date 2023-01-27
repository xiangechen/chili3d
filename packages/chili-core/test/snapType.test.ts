// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { ObjectSnapType } from "../src";

test("test SnapType", () => {
    let ts = ObjectSnapType.endPoint | ObjectSnapType.midPoint;
    expect(ObjectSnapType.has(ts, ObjectSnapType.center)).toBeFalsy();
    expect(ObjectSnapType.has(ts, ObjectSnapType.midPoint)).toBeTruthy();
});
