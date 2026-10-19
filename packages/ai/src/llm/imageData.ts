// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Split a data URL into its media type and payload. One parser for both directions (a File being
 * read into an attachment, a renderer's `toDataURL` being sent to the model): the header is
 * everything between `data:` and the first comma, and the media type is its first `;`-separated
 * field. A URL without a `;` (or without the whole header) must not slice past the payload.
 */
export function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
    const comma = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || comma < 0) return { mediaType: "", data: dataUrl };
    return {
        mediaType: dataUrl.slice("data:".length, comma).split(";")[0] ?? "",
        data: dataUrl.slice(comma + 1),
    };
}
