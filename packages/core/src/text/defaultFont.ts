// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The project's default font as one shared resource: the outline every annotation draws
 * in when the user picked nothing, fetched and parsed at most once per session however
 * many callers ask at the same time, plus the em-sized glyph triangles laid off it.
 *
 * Availability is the font cache's, not this service's — whoever remembers the outline
 * (`rememberOutline`, or `outlineFor` finishing) makes it drawable for every caller. What
 * the service adds is the wait: annotation text draws nothing before the font arrives,
 * and `onLoaded` is how the annotations learn that it did.
 */

import { Logger } from "../foundation";
import type { Result } from "../foundation/result";
import { DefaultFont } from "./fontCatalog";
import { cachedOutline, type FontOutline, outlineFor, rememberOutline } from "./fontOutline";
import { type GlyphTriangles, glyphTrianglesOf, layoutGlyphTriangles } from "./glyphTriangles";

/** How long to wait before another try, and how many tries while anyone still waits. */
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 3;

export class DefaultFontService {
    private _loading?: Promise<void>;
    private _retries = 0;
    private readonly _listeners = new Set<() => void>();

    constructor(
        private readonly load: () => Promise<Result<FontOutline>> = () =>
            outlineFor(DefaultFont.family, DefaultFont.url),
    ) {}

    /** The outline, once fetched and parsed; undefined before that, when text draws nothing. */
    get outline(): FontOutline | undefined {
        return cachedOutline(DefaultFont.family, DefaultFont.url);
    }

    /** Rebuild when the font arrives — check `outline` first; this is for the wait. */
    onLoaded(listener: () => void): void {
        this._listeners.add(listener);
    }

    removeLoaded(listener: () => void): void {
        this._listeners.delete(listener);
    }

    /** Starts the fetch, once: a no-op while one is in flight or the font is already cached. */
    ensureLoaded(): void {
        if (this.outline !== undefined || this._loading !== undefined) return;
        this._loading = this.load().then((result) => {
            this._loading = undefined;
            if (result.isOk) {
                // the font cache is the outline's home, so the loaded outline goes there
                // rather than into a field of this service
                rememberOutline(DefaultFont.family, DefaultFont.url, result.value);
                this._retries = 0;
                for (const listener of this._listeners) {
                    listener();
                }
                return;
            }
            Logger.warn(`The default font is unavailable: ${result.error}`);
            // A fetch hiccup must not silence annotation text that is already on screen:
            // the service is asked for a try every time someone still waits for it.
            if (this._retries < MAX_RETRIES && this._listeners.size > 0) {
                this._retries++;
                setTimeout(() => this.ensureLoaded(), RETRY_DELAY_MS);
            }
        });
    }

    /** The em-sized triangles of one character, triangulated once per font and character. */
    glyph(codePoint: number): GlyphTriangles | undefined {
        const outline = this.outline;
        return outline === undefined ? undefined : glyphTrianglesOf(outline, codePoint);
    }

    /** Pen advance, in ems, for a character the font has no glyph for. */
    get missingAdvance(): number {
        const outline = this.outline;
        return outline === undefined ? 0 : outline.missingAdvance / outline.unitsPerEm;
    }

    /** One line of `text` as em-sized triangles centered on the origin; empty before the font arrives. */
    layout(text: string): Float32Array {
        const outline = this.outline;
        if (outline === undefined) return new Float32Array(0);
        return layoutGlyphTriangles(
            text,
            (codePoint) => glyphTrianglesOf(outline, codePoint),
            this.missingAdvance,
        );
    }
}

/** The default font of the session — every annotation's text comes from it. */
export const defaultFontService = new DefaultFontService();
