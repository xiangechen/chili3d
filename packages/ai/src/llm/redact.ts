// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Keep image bytes out of tool results, whatever a handler returns. A data URL under 512
 * characters is left alone — that is a one-pixel swatch, not an image worth naming.
 *
 * A handler that answers with an image as a data URL puts base64 into the conversation, where it
 * is text: the API's image rule (scale to 1568px, bill by area) never applies to it, base64
 * tokenizes at ~1.4 characters per token rather than four, and the result is replayed in every
 * request from then on. Measured on a 234 KB PNG: 320k characters, 221,838 tokens — one round
 * more than a 200k window, from a single `set_material`.
 *
 * The tools that hand back appearance summarize a texture themselves (`summarizeTexture`); this is
 * the net under them, so a tool written later cannot put the bytes back in. It runs where results
 * are made, so the transcript's card and the saved chat carry the same summary as the request —
 * and the bridge applies it too, because its results never pass through the chat loop.
 */
export function redactDataUrls(content: string): string {
    return content.replace(
        /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{512,})/g,
        (_match, mediaType: string, data: string) =>
            `data:${mediaType};base64,<${Math.max(1, Math.round((data.length * 3) / 4 / 1024))} KB omitted — the image is in the document, not in the result>`,
    );
}
