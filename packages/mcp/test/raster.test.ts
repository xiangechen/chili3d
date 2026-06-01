// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { renderMeshesToRgba } from "../src/render/raster";

const isBackground = (rgba: Uint8Array, i: number) =>
    rgba[i * 4] === 240 && rgba[i * 4 + 1] === 240 && rgba[i * 4 + 2] === 245;

describe("software rasterizer", () => {
    test("a front-facing triangle paints non-background pixels", () => {
        const mesh = { position: [-10, -10, 0, 10, -10, 0, 0, 10, 0], index: [0, 1, 2] };
        const { width, height, rgba } = renderMeshesToRgba([mesh], { width: 128, height: 128 });

        let drawn = 0;
        for (let i = 0; i < width * height; i++) {
            if (!isBackground(rgba, i)) drawn++;
        }
        expect(drawn).toBeGreaterThan(50);
    });

    test("empty input renders an all-background image", () => {
        const { rgba } = renderMeshesToRgba([], { width: 16, height: 16 });
        expect(isBackground(rgba, 0)).toBe(true);
        expect(isBackground(rgba, 255)).toBe(true);
    });
});
