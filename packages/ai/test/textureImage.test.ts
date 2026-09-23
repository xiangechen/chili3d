// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { stubImageRaster } from "@chili3d/core/test-utils";
import { afterEach, describe, expect, rs, test } from "@rstest/core";
import { rasterTextureSource } from "../src/tools/textureImage";

const SVG = "data:image/svg+xml,%3Csvg%20width%3D%27512%27%2F%3E";

describe("rasterTextureSource", () => {
    afterEach(() => {
        rs.useRealTimers();
        rs.restoreAllMocks();
        rs.unstubAllGlobals();
    });

    test("stores an image that is already pixels as it is", async () => {
        const png = "data:image/png;base64,AAAA";

        expect(await rasterTextureSource(png)).toBe(png);
    });

    test("leaves a value that is not a source alone", async () => {
        expect(await rasterTextureSource(42)).toBe(42);
        expect(await rasterTextureSource(undefined)).toBeUndefined();
    });

    test("leaves a cross-origin URL to the loader, its canvas cannot be read back", async () => {
        const remote = "https://cdn.example.com/wood.svg";

        expect(await rasterTextureSource(remote)).toBe(remote);
    });

    test("rasterizes an inline SVG to a PNG", async () => {
        stubImageRaster({ width: 512, height: 512, toDataURL: "data:image/png;base64,RASTERED" });

        expect(await rasterTextureSource(SVG)).toBe("data:image/png;base64,RASTERED");
    });

    test("rasterizes an SVG on this origin whatever the query says", async () => {
        const stub = { width: 8, height: 8, toDataURL: "data:image/png;base64,FROM_PATH" };
        stubImageRaster(stub);

        expect(await rasterTextureSource("/assets/grain.svg?v=2")).toBe("data:image/png;base64,FROM_PATH");
    });

    test("stores the source as given when the raster cannot be drawn", async () => {
        stubImageRaster({ width: 512, height: 512, fail: true });

        expect(await rasterTextureSource(SVG)).toBe(SVG);
    });

    test("stores the source as given when the raster never arrives", async () => {
        stubImageRaster({ width: 512, height: 512, never: true });
        rs.useFakeTimers();

        const stored = rasterTextureSource(SVG);
        await rs.advanceTimersByTimeAsync(5000);

        expect(await stored).toBe(SVG);
    });
});
