// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A font offered for download, and what it costs to take it.
 */
export interface CatalogFont {
    /** What the picker calls it — the family's own name, as designers know it. */
    family: string;
    url: string;
    /** Size of the file in bytes, so the picker can say what picking it costs. */
    size: number;
}

/**
 * A commit of the Google Fonts repository, rather than a branch: a font a
 * document was drawn in must not change under it, and a branch would let it.
 */
const PINNED = "https://cdn.jsdelivr.net/gh/google/fonts@e44c4b011a820c2cbe2fd2cfa8052037d7edb571";

/** Total bytes a font may be; jsDelivr refuses to serve anything larger. */
export const MAX_FONT_BYTES = 20 * 1024 * 1024;

/**
 * The fonts this app can fetch, in the shape the web can serve them.
 *
 * These are whole font files, not the split-up subsets a stylesheet is served:
 * a document needs every character of the font it was set in, and one file that
 * covers a script beats a hundred that each cover a sliver. A family whose file
 * is larger than the CDN will serve — Noto Serif SC is one — cannot be listed
 * here at all, whatever it would be good for.
 *
 * Every one is open-licensed, which is what makes them safe to pull into a
 * document and keep there.
 */
export const FontCatalog: readonly CatalogFont[] = [
    { family: "Roboto", url: `${PINNED}/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf`, size: 488_584 },
    { family: "Open Sans", url: `${PINNED}/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf`, size: 532_636 },
    { family: "Fira Mono", url: `${PINNED}/ofl/firamono/FiraMono-Regular.ttf`, size: 174_596 },
    { family: "Noto Sans SC", url: `${PINNED}/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf`, size: 17_772_300 },
    { family: "Noto Sans TC", url: `${PINNED}/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf`, size: 11_941_968 },
    { family: "Noto Sans JP", url: `${PINNED}/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf`, size: 9_589_900 },
    { family: "Noto Sans KR", url: `${PINNED}/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf`, size: 10_414_588 },
];

/**
 * The font a new text is drawn in, taken without asking.
 *
 * It is the one family here that covers Latin and Chinese both. A smaller
 * default would be cheaper to fetch and would silently drop every Chinese
 * character typed into it, and a first attempt at text that renders as a gap
 * reads as a broken feature rather than as a font that lacks a glyph.
 */
export const DefaultFont: CatalogFont = FontCatalog[3];
