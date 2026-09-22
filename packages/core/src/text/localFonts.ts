// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "../foundation";

/**
 * The Local Font Access API, declared here because TypeScript's DOM library does
 * not carry it. Declaring it locally rather than augmenting `Window` keeps a
 * Chromium-only, permission-gated API from looking like part of the platform.
 */
interface LocalFontData {
    family: string;
    style: string;
    postscriptName: string;
    blob(): Promise<Blob>;
}

interface LocalFontAccess {
    queryLocalFonts?(options?: { postscriptNames?: string[] }): Promise<LocalFontData[]>;
}

/** One installed font the user can pick, with its bytes read only when chosen. */
export interface LocalFontEntry {
    family: string;
    style: string;
    postscriptName: string;
    read(): Promise<ArrayBuffer>;
}

const localFontAccess = () => window as unknown as LocalFontAccess;

/**
 * Whether this browser can hand over the fonts installed on the machine. Only
 * Chromium can, and only after the user grants permission, so callers fall back
 * to reading a file the user picks.
 */
export function hasLocalFontAccess(): boolean {
    return typeof localFontAccess().queryLocalFonts === "function";
}

/**
 * List the installed fonts. Reading every font's bytes up front would pull tens
 * of megabytes out of the system for a list nobody has picked from yet, so each
 * entry reads its own bytes on demand.
 *
 * A refused permission prompt and a browser that cannot enumerate fonts are
 * both ordinary outcomes — the caller falls back to a file picker.
 */
export async function listLocalFonts(): Promise<Result<LocalFontEntry[]>> {
    const query = localFontAccess().queryLocalFonts;
    if (query === undefined) return Result.err("This browser cannot list local fonts");

    try {
        const fonts = await query.call(localFontAccess());
        return Result.ok(
            fonts
                .map((font) => ({
                    family: font.family,
                    style: font.style,
                    postscriptName: font.postscriptName,
                    read: () => font.blob().then((blob) => blob.arrayBuffer()),
                }))
                .sort(
                    (left, right) =>
                        left.family.localeCompare(right.family) || left.style.localeCompare(right.style),
                ),
        );
    } catch (error) {
        return Result.err(`Could not list local fonts: ${error}`);
    }
}
