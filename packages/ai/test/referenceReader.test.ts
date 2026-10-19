// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readReference } from "../src/llm/referenceReader";
import type { ImagePart, LLMProvider, StreamEvent } from "../src/llm/types";
import type { LLMConfig } from "../src/settings";

const CONFIG: LLMConfig = { provider: "anthropic", apiKey: "k", model: "m" };
const IMAGES: ImagePart[] = [{ mediaType: "image/png", data: "aGVsbG8=" }];

function rejecting(err: unknown): AsyncIterable<StreamEvent> {
    return {
        [Symbol.asyncIterator]() {
            return { next: () => Promise.reject(err) };
        },
    };
}

describe("readReference", () => {
    test("sends one user message with the images and no tools or history", async () => {
        const seen: { messages: unknown; tools: unknown } = { messages: undefined, tools: undefined };
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* (opts) {
                seen.messages = opts.messages;
                seen.tools = opts.tools;
                yield { type: "text", text: "A rectangular plate." };
                yield { type: "done", stopReason: "end_turn" };
            },
        };

        const reading = await readReference({ config: CONFIG, images: IMAGES, provider });

        expect(seen.messages).toEqual([expect.objectContaining({ role: "user", images: IMAGES })]);
        expect(seen.tools).toEqual([]);
        expect(reading).toEqual({ ok: true, report: "A rectangular plate." });
    });

    test("collects the report across streamed text events", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "text", text: "A plate " };
                yield { type: "text", text: "with one hole." };
                yield { type: "done", stopReason: "end_turn" };
            },
        };

        const reading = await readReference({ config: CONFIG, images: IMAGES, provider });

        expect(reading).toEqual({ ok: true, report: "A plate with one hole." });
    });

    test("fails open when the endpoint rejects the image", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: () => rejecting(new Error("image input is not supported")),
        };

        const reading = await readReference({ config: CONFIG, images: IMAGES, provider });

        expect(reading.ok).toBe(false);
        expect(reading.error).toContain("not supported");
    });

    test("fails open when the reader returns no text", async () => {
        const provider: LLMProvider = {
            id: "fake",
            streamChat: async function* () {
                yield { type: "done", stopReason: "end_turn" };
            },
        };

        const reading = await readReference({ config: CONFIG, images: IMAGES, provider });

        expect(reading.ok).toBe(false);
        expect(reading.error).toContain("no text");
    });
});
