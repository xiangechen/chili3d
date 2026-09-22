// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "../foundation";

/**
 * The subset of opentype.js this feature uses, written out here because the
 * library is loaded from a URL at runtime and therefore has no module the
 * compiler could read types from. Every field is what the real API returns for
 * a parsed font; `packages/core/test/text/openTypeOutline.test.ts` pins the
 * shapes a real font produces.
 */
/**
 * A path command as opentype.js states it: `Q` carries one control point, `C`
 * carries two, and both end on an on-curve point. Points are font units with y
 * growing upward from the baseline, so no axis flip is needed.
 */
export type OpenTypeCommand =
    | { type: "M"; x: number; y: number }
    | { type: "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };

export interface OpenTypeGlyph {
    /** 0 is `.notdef`, which is what a font returns for a character it lacks. */
    index: number;
    advanceWidth?: number;
    path: { commands: OpenTypeCommand[] };
}

export interface OpenTypeFont {
    unitsPerEm: number;
    /** Keyed by platform; `unicode` is the one a modern font fills in. */
    names?: Partial<Record<"unicode" | "windows" | "macintosh", { fontFamily?: { en?: string } }>>;
    /**
     * The glyph for a character — a *string*, since opentype.js reads the code
     * point off it. A character the font lacks answers with `.notdef`, glyph 0.
     */
    charToGlyph(character: string): OpenTypeGlyph;
    /** Glyphs by index. The only way to reach `.notdef`, which has no character. */
    glyphs: { get(index: number): OpenTypeGlyph };
}

export interface OpenTypeModule {
    parse(buffer: ArrayBuffer): OpenTypeFont;
}

/**
 * opentype.js is not a dependency of this project: it is fetched from a pinned
 * CDN URL the first time anyone uses text. The URL is a constant in this file
 * rather than anything a document or a `?plugin=` parameter can name, so it
 * sits at the same trust level as the app bundle itself — `Config.trustedDomains`
 * is the covenant for URLs a *document* supplies, and does not apply here.
 *
 * The version is part of the path, which makes the URL immutable on jsDelivr.
 */
const OPEN_TYPE_URL = "https://cdn.jsdelivr.net/npm/opentype.js@2.0.0/dist/opentype.min.mjs";

let loading: Promise<Result<OpenTypeModule>> | undefined;

/**
 * Fetch opentype.js once per session. The promise is cached rather than the
 * module so concurrent callers share one request.
 */
export function loadOpenType(): Promise<Result<OpenTypeModule>> {
    loading ??= load();
    return loading;
}

async function load(): Promise<Result<OpenTypeModule>> {
    try {
        // The URL is built at runtime, so the bundler must leave the import alone.
        const module = (await import(/* webpackIgnore: true */ OPEN_TYPE_URL)) as OpenTypeModule;
        return typeof module.parse === "function"
            ? Result.ok(module)
            : Result.err(`opentype.js at ${OPEN_TYPE_URL} has no parse() function`);
    } catch (error) {
        loading = undefined;
        return Result.err(`Failed to load opentype.js: ${error}`);
    }
}
