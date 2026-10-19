// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { LLMConfig } from "../settings";
import { createProvider } from "./provider";
import type { ImagePart, LLMProvider, SystemPrompt } from "./types";

export interface ReferenceReading {
    ok: boolean;
    report?: string;
    error?: string;
}

export interface ReadReferenceOptions {
    config: LLMConfig;
    images: ImagePart[];
    signal?: AbortSignal;
    /** Injected by tests; production builds one from the config. */
    provider?: LLMProvider;
}

/** A report longer than this is the reader re-describing the model, not the reference. */
const REPORT_MAX_CHARS = 6000;

/**
 * The reader's whole context. It deliberately carries no CAD instructions and no conversation: an
 * isolated question reads the image correctly where the same model, already planning a build, has
 * been measured to mirror it. See classcad-ai's perception gate for the failure this isolates.
 */
const READER_SYSTEM: SystemPrompt = {
    stable:
        "You are an independent reader of engineering images. Describe what is visible. Do not infer " +
        "intent, and do not propose a modeling plan.",
    volatile: "",
};

/**
 * One question, asked of the images only. The reader gets no history and no tools, so its answer
 * cannot be shaped by what the main assistant has already decided to build.
 */
const READER_INSTRUCTION = `Read the attached reference image(s) and report, in about 300 words:
- the overall shape and its proportions;
- every visible feature (holes, slots, steps, fillets, chamfers, shells, ribs);
- the orientation, and which side is front/top when the image makes it clear;
- any dimensions, annotations or text;
- anything you cannot determine — say it is unknown rather than guessing.`;

/**
 * Ask an isolated model call what the reference shows. It never throws: a provider that cannot
 * accept images, or a user who cancels, leaves the caller to decide whether to continue.
 */
export async function readReference(options: ReadReferenceOptions): Promise<ReferenceReading> {
    let text = "";
    try {
        // Construction is inside the try too: a provider that validates its key and throws would
        // otherwise reject this promise and turn the gate's fail-open into a fail-closed.
        const provider = options.provider ?? createProvider(options.config);
        for await (const event of provider.streamChat({
            model: options.config.model,
            effort: options.config.reasoningEffort,
            system: READER_SYSTEM,
            messages: [{ role: "user", content: READER_INSTRUCTION, images: options.images }],
            tools: [],
            signal: options.signal,
        })) {
            if (event.type === "text") text += event.text;
        }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const report = text.trim().slice(0, REPORT_MAX_CHARS);
    return report ? { ok: true, report } : { ok: false, error: "the reader returned no text" };
}
