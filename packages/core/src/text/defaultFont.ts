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

import { Logger, PubSub } from "../foundation";
import type { Result } from "../foundation/result";
import { DefaultFont } from "./fontCatalog";
import { cachedOutline, type FontOutline, outlineFor, rememberOutline } from "./fontOutline";
import { type GlyphTriangles, glyphTrianglesOf, layoutGlyphTriangles } from "./glyphTriangles";

/** How long to wait before another quick try, and how many of those while anyone still waits. */
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 3;

/**
 * Once the quick retries are spent, keep trying slowly in the background: a
 * network that comes back should find the font without the page being reloaded.
 */
const SLOW_RETRY_DELAY_MS = 60_000;

/**
 * The mirrors the default font is fetched from, in turn: the same file at the
 * same path on each of them, only the host changes, so one unreachable host
 * must not take every annotation's text with it.
 */
const FONT_MIRRORS = ["cdn.jsdelivr.net", "fastly.jsdelivr.net", "gcore.jsdelivr.net"];

/** The address of the same file on the `attempt`-th mirror. */
function mirrorUrl(url: string, attempt: number): string {
    const host = FONT_MIRRORS[attempt % FONT_MIRRORS.length];
    return url.replace(/^https:\/\/[^/]+/, `https://${host}`);
}

export class DefaultFontService {
    private _loading?: Promise<void>;
    private _failures = 0;
    private readonly _listeners = new Set<() => void>();

    constructor(
        private readonly load: (url: string) => Promise<Result<FontOutline>> = (url) =>
            outlineFor(DefaultFont.family, url),
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
        this._loading = this.load(mirrorUrl(DefaultFont.url, this._failures)).then((result) => {
            this._loading = undefined;
            if (result.isOk) {
                // the font cache is the outline's home, so the loaded outline goes there
                // rather than into a field of this service
                rememberOutline(DefaultFont.family, DefaultFont.url, result.value);
                this._failures = 0;
                for (const listener of this._listeners) {
                    listener();
                }
                return;
            }
            Logger.warn(`The default font is unavailable: ${result.error}`);
            // A fetch hiccup must not silence annotation text that is already on screen:
            // the service is asked for a try every time someone still waits for it.
            if (this._listeners.size === 0) return;
            this._failures++;
            if (this._failures === MAX_RETRIES + 1) {
                // the quick retries are spent and the wait goes on — say so once,
                // then keep trying quietly until the network comes back
                PubSub.default.pub("showToast", "toast.text.defaultFontFailed");
            }
            const delay = this._failures <= MAX_RETRIES ? RETRY_DELAY_MS : SLOW_RETRY_DELAY_MS;
            setTimeout(() => this.ensureLoaded(), delay);
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
