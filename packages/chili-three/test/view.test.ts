// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { expect, jest, test } from "@jest/globals";
import { Plane, XY, XYZ } from "chili-core";
import { TestDocument } from "./testDocument";
import { TestView } from "./testView";

describe("test view", () => {
    test("test mouse", () => {
        let doc = new TestDocument();
        let view = new TestView(doc.visual.viewer, doc.visual.scene);
        expect(view.screenToCameraRect(0, 0)).toEqual(new XY(-1, 1));
        expect(view.screenToCameraRect(100, 100)).toEqual(new XY(1, -1));

        // view.camera.position.set(0, 0, 10);
        // view.camera.lookAt(0, 0, 0);
    });
});
