// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { redactDataUrls } from "../llm/redact";
import type { ImagePart, Tool } from "../llm/types";
import { buildTools } from "./index";

/** The half of a tool a caller outside this page may hold: schemas are data, handlers are not. */
export interface ToolDescriptor {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** What a call returns to a caller that has no chat UI to render a `ToolResult` into. */
export interface ToolReply {
    ok: boolean;
    content: string;
    images?: ImagePart[];
}

/**
 * The assistant's tool surface for a client that lives outside this page: `bridge/` (in
 * `src/bridge`) builds one and forwards the calls an external agent makes over a WebSocket, so
 * that agent drives the same registry the chat panel runs instead of a second copy of it.
 */
export interface ToolHost {
    list(): ToolDescriptor[];
    call(name: string, args: Record<string, unknown>): Promise<ToolReply>;
}

/**
 * Tools the page keeps for its own assistant. `ask_user` needs the in-app transcript to draw its
 * card, and the calling agent has a conversation of its own to ask in — over the bridge it would
 * return a "no panel" error as a success, or block on a card the user is not expecting.
 */
const BRIDGE_UNSUPPORTED = new Set(["ask_user"]);

export function createToolHost(): ToolHost {
    // Built once per host. That is not the same promise the chat panel makes — it rebuilds
    // `buildTools()` per request so a skill registered after startup is advertised on the next
    // turn — but the bridge sends its list once, at hello: a late registration would need a new
    // page connection to reach the external agent either way.
    const tools = new Map(buildTools().map((tool) => [tool.name, tool]));
    return {
        list: () =>
            [...tools.values()].filter((tool) => !BRIDGE_UNSUPPORTED.has(tool.name)).map(toDescriptor),
        async call(name, args) {
            if (BRIDGE_UNSUPPORTED.has(name)) {
                return {
                    ok: false,
                    content: `${name} is not available over the bridge; ask the user in your own conversation.`,
                };
            }
            const tool = tools.get(name);
            if (!tool) return { ok: false, content: `Unknown tool: ${name}` };
            try {
                const result = await tool.handler(args ?? {});
                // The bridge result never passes through the chat loop's redaction, and it is
                // replayed by the calling agent too: the same bytes rule applies here.
                if (typeof result === "string") {
                    return { ok: true, content: redactDataUrls(result) };
                }
                return { ok: true, content: redactDataUrls(result.content), images: result.images };
            } catch (error) {
                // The chat loop lets a throwing handler end the run; a bridge caller has no run to
                // end, so the failure is reported back to the calling model as the tool's answer.
                const message = error instanceof Error ? error.message : String(error);
                return { ok: false, content: redactDataUrls(message) };
            }
        },
    };
}

function toDescriptor(tool: Tool): ToolDescriptor {
    return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
