// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Camera, OrthographicCamera, Plane } from "three";
import { expect, jest, test } from "@jest/globals";
import { IViewer } from "chili-core";
import { CursorType } from "chili-vis";
import { Document } from "chili-core";

describe("test view", () => {
    test("test mouse", () => {
        expect(1 + 1).toBe(2)
    });
});
