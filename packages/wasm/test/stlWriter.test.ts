// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { meshesToStl } from "@chili3d/wasm/src/stlWriter";
import { describe, expect, test } from "@rstest/core";

// One triangle in the z=0 plane, wound CCW → geometric normal points +Z.
const TRI = { position: [0, 0, 0, 1, 0, 0, 0, 1, 0], index: [0, 1, 2] };

describe("stlWriter", () => {
    test("binary STL has header, triangle count, geometric normal and attribute", () => {
        const bytes = meshesToStl([TRI], { binary: true });
        expect(bytes.length).toBe(84 + 50);

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        // a binary STL header must not begin with "solid"
        expect(new TextDecoder().decode(bytes.subarray(0, 5))).not.toBe("solid");
        expect(view.getUint32(80, true)).toBe(1);
        // facet normal = +Z
        expect(view.getFloat32(84, true)).toBeCloseTo(0);
        expect(view.getFloat32(88, true)).toBeCloseTo(0);
        expect(view.getFloat32(92, true)).toBeCloseTo(1);
        // first vertex = (0,0,0)
        expect(view.getFloat32(96, true)).toBeCloseTo(0);
        expect(view.getFloat32(100, true)).toBeCloseTo(0);
        expect(view.getFloat32(104, true)).toBeCloseTo(0);
        // attribute byte count (last 2 bytes of the 50-byte record) = 0
        expect(view.getUint16(132, true)).toBe(0);
    });

    test("ascii STL is well-formed", () => {
        const text = new TextDecoder().decode(meshesToStl([TRI], { binary: false, name: "t" }));
        expect(text.startsWith("solid t")).toBe(true);
        expect(text.trimEnd().endsWith("endsolid t")).toBe(true);
        expect((text.match(/facet normal/g) ?? []).length).toBe(1);
        expect((text.match(/vertex /g) ?? []).length).toBe(3);
    });

    test("counts triangles across meshes; binary is the default", () => {
        const two = { position: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], index: [0, 1, 2, 0, 1, 3] };
        const bytes = meshesToStl([TRI, two]);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        expect(view.getUint32(80, true)).toBe(3);
        expect(bytes.length).toBe(84 + 50 * 3);
    });

    test("empty input yields a valid zero-triangle binary STL", () => {
        const bytes = meshesToStl([], { binary: true });
        expect(bytes.length).toBe(84);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        expect(view.getUint32(80, true)).toBe(0);
    });
});
