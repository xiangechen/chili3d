// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { Result } from "../../src/foundation";
import type { FontOutline } from "../../src/text/fontOutline";
import {
    cachedOutline,
    type OpenTypeLoader,
    outlineFor,
    outlineOfPicked,
    parseFont,
    rememberOutline,
} from "../../src/text/fontOutline";
import type { OpenTypeCommand, OpenTypeFont, OpenTypeModule } from "../../src/text/openTypeModule";

const dataUrl = (text: string) => `data:font/ttf;base64,${btoa(text)}`;

/** A font whose bytes are the text "font!", so a parse only succeeds for real bytes. */
const outlineStub = (): FontOutline => ({
    familyName: "stub",
    unitsPerEm: 1000,
    missingAdvance: 500,
    glyph: () => undefined,
});

afterEach(() => {
    rs.unstubAllGlobals();
});

const square: OpenTypeCommand[] = [
    { type: "M", x: 0, y: 0 },
    { type: "L", x: 500, y: 0 },
    { type: "L", x: 500, y: 500 },
    { type: "L", x: 0, y: 500 },
    { type: "Z" },
];

interface FakeFontOptions {
    glyphs?: Record<string, OpenTypeCommand[]>;
    names?: OpenTypeFont["names"];
}

function openTypeWith({ glyphs = {}, names }: FakeFontOptions = {}) {
    const parsed: ArrayBuffer[] = [];
    const at = (key: string) => {
        const missing = key.charCodeAt(0) === 0 || !(key in glyphs);
        return {
            index: missing ? 0 : 1,
            advanceWidth: missing ? 600 : 700,
            path: { commands: missing ? [] : glyphs[key] },
        };
    };
    const module: OpenTypeModule = {
        parse: (buffer) => {
            parsed.push(buffer);
            return {
                unitsPerEm: 1000,
                names,
                charToGlyph: (character: string) => at(character),
                glyphs: { get: (index: number) => at(index === 0 ? "\u0000" : String.fromCodePoint(index)) },
            };
        },
    };
    return { module, parsed };
}

const bytes = new ArrayBuffer(4);

let loadOpenTypeMock: ReturnType<typeof rs.fn<OpenTypeLoader>>;

beforeEach(() => {
    loadOpenTypeMock = rs.fn<OpenTypeLoader>();
});

describe("outlineOfPicked", () => {
    test("uses the bytes the user handed over, not an address the font also has", async () => {
        const fetchMock = rs.fn();
        rs.stubGlobal("fetch", fetchMock);

        const outline = await outlineOfPicked({
            name: "Mine.ttf",
            data: dataUrl("font!"),
            url: "https://cdn.example/mine.ttf",
        });

        // A font just read off a disk is not fetched back from anywhere.
        expect(fetchMock.mock.calls.length).toBe(0);
        // Those bytes are not a font, and Node has no parser to reach for anyway
        // (the browser fetches one from the CDN), so the parse is out of scope here.
        expect(outline.isOk).toBe(false);
    });

    test("refuses bytes that are not a data URL", async () => {
        const outline = await outlineOfPicked({ name: "Mine.ttf", data: "not a data url" });

        expect(outline.isOk).toBe(false);
        expect(outline.error).toContain("not readable");
    });

    test("draws in the outline already parsed for a font it has seen", async () => {
        const fetchMock = rs.fn();
        rs.stubGlobal("fetch", fetchMock);
        rememberOutline("Noto Sans SC", "https://cdn.example/sc.ttf", outlineStub());

        const outline = await outlineOfPicked({
            name: "Noto Sans SC",
            url: "https://cdn.example/sc.ttf",
        });

        expect(outline.isOk).toBe(true);
        expect(fetchMock.mock.calls.length).toBe(0);
    });
});

describe("outlineFor", () => {
    test("fetches the font from the address the text kept", async () => {
        const fetchMock = rs.fn(async (_url: string) => new Response(new Uint8Array([0, 1, 0, 0])));
        rs.stubGlobal("fetch", fetchMock);

        const outline = await outlineFor("Roboto", "https://cdn.example/roboto.ttf");

        expect(fetchMock.mock.calls[0][0]).toBe("https://cdn.example/roboto.ttf");
        // Those bytes are not a font either; what matters is that it went and got them.
        expect(outline.isOk).toBe(false);
    });

    test("reports a font that is neither at hand nor at an address", async () => {
        // A font off a disk, in a later session: the outlines a node drew are
        // still there, but laying the text out again has nothing to work from.
        const outline = await outlineFor("Mine.ttf", "");

        expect(outline.isOk).toBe(false);
        expect(outline.error).toContain("not at hand");
    });

    test("reports an address that would not hand the font over", async () => {
        rs.stubGlobal(
            "fetch",
            rs.fn(async () => new Response("nope", { status: 403 })),
        );

        const outline = await outlineFor("Huge", "https://cdn.example/huge.ttf");

        expect(outline.isOk).toBe(false);
        expect(outline.error).toContain("403");
    });

    test("reports an address that could not be reached", async () => {
        rs.stubGlobal(
            "fetch",
            rs.fn(async () => {
                throw new Error("offline");
            }),
        );

        const outline = await outlineFor("Roboto", "https://cdn.example/roboto.ttf");

        expect(outline.isOk).toBe(false);
        expect(outline.error).toContain("offline");
    });
});

describe("the remembered outlines", () => {
    test("are filed by address when a font has one", () => {
        const outline = outlineStub();
        rememberOutline("Roboto", "https://cdn.example/roboto.ttf", outline);

        expect(cachedOutline("Roboto", "https://cdn.example/roboto.ttf")).toBe(outline);
        // The same name at a different address is a different font.
        expect(cachedOutline("Roboto", "https://cdn.example/other.ttf")).toBeUndefined();
    });

    test("are filed by name for a font off a disk, which has no address", () => {
        const outline = outlineStub();
        rememberOutline("Mine.ttf", "", outline);

        expect(cachedOutline("Mine.ttf", "")).toBe(outline);
    });
});

describe("parseFont", () => {
    test("reads a font file into outlines", async () => {
        const { module, parsed } = openTypeWith({ glyphs: { A: square } });
        loadOpenTypeMock.mockResolvedValue(Result.ok(module));

        const result = await parseFont(bytes, "Picked", loadOpenTypeMock);

        expect(parsed).toEqual([bytes]);
        expect(result.isOk).toBe(true);
        expect(result.value.unitsPerEm).toBe(1000);
        expect(result.value.missingAdvance).toBe(600);
        expect(result.value.glyph(65)?.contours.length).toBe(1);
        expect(result.value.glyph(65)?.advance).toBe(700);
    });

    test("names the font after what the user picked when the file states no name", async () => {
        loadOpenTypeMock.mockResolvedValue(Result.ok(openTypeWith({ glyphs: { A: square } }).module));

        const result = await parseFont(bytes, "Picked", loadOpenTypeMock);

        expect(result.value.familyName).toBe("Picked");
    });

    test("prefers the name the file states for itself", async () => {
        const module = openTypeWith({
            glyphs: { A: square },
            names: { unicode: { fontFamily: { en: "Stated" } } },
        }).module;
        loadOpenTypeMock.mockResolvedValue(Result.ok(module));

        const result = await parseFont(bytes, "Picked", loadOpenTypeMock);

        expect(result.value.familyName).toBe("Stated");
    });

    test("reports the loader's failure", async () => {
        loadOpenTypeMock.mockResolvedValue(Result.err("Failed to load opentype.js: offline"));

        const result = await parseFont(bytes, "Picked", loadOpenTypeMock);

        expect(result.isOk).toBe(false);
        expect(result.error).toContain("offline");
    });

    test("reports bytes that are not a font", async () => {
        loadOpenTypeMock.mockResolvedValue(
            Result.ok({
                parse: () => {
                    throw new Error("Unsupported OpenType signature");
                },
            }),
        );

        const result = await parseFont(bytes, "Picked", loadOpenTypeMock);

        expect(result.isOk).toBe(false);
        expect(result.error).toContain("Failed to read the font");
        expect(result.error).toContain("Unsupported OpenType signature");
    });
});
