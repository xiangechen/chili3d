// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { ShapeFactory } from "../src";
import "./setup";

describe("OCCT WASM in Node (headless smoke)", () => {
    test("loads the kernel and builds a box solid with a non-empty mesh", () => {
        const factory = new ShapeFactory();
        const box = factory.box(Plane.XY, 10, 20, 30);
        expect(box.isOk).toBe(true);

        const faces = box.value.mesh.faces;
        expect(faces).toBeDefined();
        expect(faces!.position.length).toBeGreaterThan(0);
        expect(faces!.index.length).toBeGreaterThan(0);
        // indices come in triangles
        expect(faces!.index.length % 3).toBe(0);
    });
});
