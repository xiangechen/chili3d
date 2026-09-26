// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The one font the annotation batches draw in. Bytes are fetched and parsed by
 * core's `outlineFor` (opentype.js comes from a pinned CDN on first use); this
 * service adds the triangulation cache on top and notifies when the font
 * arrives, so annotations rebuild their text slices once drawing is possible.
 */

import { DefaultFont, type FontOutline, outlineFor, type Result } from "@chili3d/core";
import { type GlyphGeometry, triangulateGlyph } from "./glyphGeometry";

export class AnnotationFont {
    private _outline?: FontOutline;
    private _loading?: Promise<void>;
    private _retries = 0;
    private readonly _glyphs = new Map<number, GlyphGeometry | undefined>();
    private readonly _listeners = new Set<() => void>();

    constructor(
        private readonly load: () => Promise<Result<FontOutline>> = () =>
            outlineFor(DefaultFont.family, DefaultFont.url),
    ) {}

    /** Undefined until the font has been fetched and parsed — text draws nothing before that. */
    get outline(): FontOutline | undefined {
        return this._outline;
    }

    onLoaded(listener: () => void): void {
        this._listeners.add(listener);
    }

    removeLoaded(listener: () => void): void {
        this._listeners.delete(listener);
    }

    ensureLoaded(): void {
        if (this._outline !== undefined || this._loading !== undefined) return;
        this._loading = this.load().then((result) => {
            if (result.isOk) {
                this._outline = result.value;
                this._retries = 0;
                for (const listener of this._listeners) {
                    listener();
                }
                return;
            }
            console.warn(`Annotation font unavailable: ${result.error}`);
            this._loading = undefined;
            // A CDN hiccup must not silence every annotation already on screen:
            // retry while anyone is still waiting for the font.
            if (this._retries < 3 && this._listeners.size > 0) {
                this._retries++;
                setTimeout(() => this.ensureLoaded(), 5000);
            }
        });
    }

    /** The em-sized geometry of a character, triangulated on first ask; undefined when the font lacks it. */
    glyph(codePoint: number): GlyphGeometry | undefined {
        if (this._outline === undefined) return undefined;
        if (!this._glyphs.has(codePoint)) {
            const glyph = this._outline.glyph(codePoint);
            this._glyphs.set(
                codePoint,
                glyph === undefined ? undefined : triangulateGlyph(glyph, this._outline.unitsPerEm),
            );
        }
        return this._glyphs.get(codePoint);
    }

    /** Pen advance for a character the font has no glyph for, in ems. */
    get missingAdvance(): number {
        return this._outline === undefined ? 0 : this._outline.missingAdvance / this._outline.unitsPerEm;
    }
}

export const annotationFont = new AnnotationFont();
