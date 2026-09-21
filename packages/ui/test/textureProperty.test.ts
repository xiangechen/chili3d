// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// biome-ignore assist/source/organizeImports: import order is load-bearing — test-utils must load before the core-mock helper, and the helper before the module under test
import type { I18nKeys, Texture } from "@chili3d/core";
// test-utils must load BEFORE the core-mock helper so the real core module is
// fully cached by the time `rs.mock("@chili3d/core")` registers.
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, test } from "@rstest/core";

// Mock CSS module under test
rs.mock("../src/property/textureProperty.module.css", () => ({
    root: "tx-root",
    expander: "tx-expander",
    properties: "tx-properties",
    image: "tx-image",
}));

// basicPropertyControl is replaced with a recording stub — it has its own test
// file (propertyControl.test.ts).
const basicControlMock = rs.hoisted(() =>
    rs.fn(() => {
        const el = document.createElement("div");
        el.className = "mock-basic-control";
        return el;
    }),
);

rs.mock("../src/property/basicPropertyControl", () => ({
    basicPropertyControl: basicControlMock,
}));

// Mock element helpers and core services
import "./_helpers/mockElement";
import { readFileAsyncMock } from "./_helpers/mockCoreTexture";

import { TextureProperty } from "../src/property/textureProperty";
import { mustQuery } from "./_helpers/domHelpers";

describe("TextureProperty", () => {
    const display = "test.texture" as I18nKeys;

    function createTexture() {
        return { image: "data:image/png;base64,old", wrapS: 1 } as unknown as Texture;
    }

    beforeEach(() => {
        basicControlMock.mockClear();
        readFileAsyncMock.mockReset();
    });

    describe("constructor", () => {
        test("should add the root style class", () => {
            const prop = new TextureProperty(createMockDocument(), display, createTexture());
            expect(prop.classList.contains("tx-root")).toBe(true);
        });

        test("should render controls for all texture properties except image", () => {
            const doc = createMockDocument();
            const texture = createTexture();
            const prop = new TextureProperty(doc, display, texture);

            // PropertyUtils stub returns wrapS + image; image is filtered out
            expect(basicControlMock).toHaveBeenCalledTimes(1);
            expect(basicControlMock).toHaveBeenCalledWith(
                doc,
                [texture],
                expect.objectContaining({ name: "wrapS" }),
            );
            mustQuery(prop, ".tx-properties");
        });

        test("should render the texture image and a remove icon", () => {
            const prop = new TextureProperty(createMockDocument(), display, createTexture());
            mustQuery(prop, ".tx-image img");
            mustQuery(prop, ".tx-image svg");
        });
    });

    describe("image editing", () => {
        test("should clear the texture image when the remove icon is clicked", () => {
            const texture = createTexture();
            const prop = new TextureProperty(createMockDocument(), display, texture);

            const icon = mustQuery(prop, ".tx-image svg");
            const onclick = (icon as unknown as { _onclick?: () => void })._onclick;
            expect(onclick).toBeDefined();
            onclick!();

            expect(texture.image).toBe("");
        });

        test("should assign the picked file data URL to the texture image", async () => {
            readFileAsyncMock.mockResolvedValue({
                isOk: true,
                value: [{ data: "data:image/png;base64,new" }],
            });
            const texture = createTexture();
            const prop = new TextureProperty(createMockDocument(), display, texture);

            const img = mustQuery(prop, ".tx-image img");
            const onclick = (img as unknown as { _onclick?: () => Promise<void> })._onclick;
            expect(onclick).toBeDefined();
            await onclick!();

            expect(readFileAsyncMock).toHaveBeenCalledWith(".png, .jpg, .jpeg", false, "readAsDataURL");
            expect(texture.image).toBe("data:image/png;base64,new");
        });

        test("should keep the texture when the pick comes back as an error", async () => {
            // a cancelled dialog resolves with an error Result whose value is undefined; reading
            // on would throw inside the click handler and leave the surface unchanged in silence
            readFileAsyncMock.mockResolvedValue({ isOk: false, error: "cancel", value: undefined });
            const texture = createTexture();
            texture.image = "data:image/png;base64,kept";
            const prop = new TextureProperty(createMockDocument(), display, texture);

            const img = mustQuery(prop, ".tx-image img");
            const onclick = (img as unknown as { _onclick?: () => Promise<void> })._onclick;
            await onclick?.();

            expect(texture.image).toBe("data:image/png;base64,kept");
        });
    });
});
