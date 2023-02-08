// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Validation } from "../src";

test("test validation", () => {
    let ok = Validation.ok();
    expect(ok.error).toBeUndefined();
    expect(ok.isOk).toBeTruthy();
    let err = Validation.error("error.default");
    expect(err.error).toBe("error.default");
    expect(err.isOk).toBeFalsy();
});
