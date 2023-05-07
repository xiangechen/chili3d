// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Camera, OrthographicCamera } from "three";
import { expect, jest, test } from "@jest/globals";
import { Plane, XYZ } from "chili-core";
import { TestDocument } from "./testDocument";
import { ThreeView } from "../src/threeView";

const div = document.createElement("div");
div.style.width = "100px";
div.style.height = "100px";
document.body.appendChild(div);

describe("test view", () => {
    test("test mouse", () => {
        expect(div.style.width).toEqual("100px");
        expect(div.parentElement).toEqual(document.body);

        let doc = new TestDocument();
        let view = new ThreeView(doc.visualization, "test", Plane.XY, div, doc.visualization.scene);
        expect(view.screenToWorld(50, 50)).toEqual(XYZ.zero);

        // view.camera.position.set(0, 0, 10);
        // view.camera.lookAt(0, 0, 0);
    });
});
