// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Tool } from "../llm/types";

export interface AskRequest {
    question: string;
    options?: string[];
}

/** Hands a question to the live transcript and resolves with the user's answer. */
export type AskHandler = (request: AskRequest, signal?: AbortSignal) => Promise<string>;

/**
 * The chat panel showing the transcript, or undefined when no chat UI is mounted (a bare tool run
 * in tests, or headless use). Same module-level-singleton shape as `getDocument` in
 * documentContext.ts: the panel registers on construction and the tool reaches it from here.
 */
let handler: AskHandler | undefined;

export function setAskHandler(next: AskHandler | undefined): void {
    handler = next;
}

function parseRequest(raw: Record<string, unknown>): AskRequest {
    const question = raw["question"];
    if (typeof question !== "string" || question.trim() === "") {
        throw new Error(`question must be a non-empty string, got ${JSON.stringify(question)}`);
    }
    const options = raw["options"];
    if (options !== undefined && (!Array.isArray(options) || options.some((o) => typeof o !== "string"))) {
        throw new Error(`options must be an array of strings, got ${JSON.stringify(options)}`);
    }
    return { question, options: options as string[] | undefined };
}

export function buildAskUserTool(): Tool {
    return {
        name: "ask_user",
        description:
            "Ask the user a question and wait for their answer before doing anything else. Reach for it only when the answer is the user's intent and cannot be read off the document, the selection or a screenshot: how big, which face, keep or discard. Give 2-4 concrete options whenever the choices are enumerable, so the user can answer in one click. Never ask for something another tool could find out.",
        parameters: {
            type: "object",
            properties: {
                question: {
                    type: "string",
                    description: "One short question, in the same language the user writes in.",
                },
                options: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Concrete answers the user can pick with one click. Omit for a free-form answer.",
                },
            },
            required: ["question"],
        },
        handler: (args, signal) => {
            const ask = handler;
            if (!ask) {
                return Promise.resolve(
                    JSON.stringify({ error: "no chat panel is open to answer this question" }),
                );
            }
            return ask(parseRequest(args), signal);
        },
    };
}
