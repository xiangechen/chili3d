// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ChatMessage } from "./types";

/**
 * Every screenshot answers "what does it look like now", which makes each older one dead weight —
 * and at a few MB of base64 apiece the largest thing in the history resent on every iteration. So
 * only the newest screenshot is replayed. Images the user attached are left alone: those are input
 * the turn was asked about, not a picture of a moment that has passed. The panel calls this before
 * a hard trim too, so a mid-run compaction keeps the one picture the model is working from.
 */
export function dropSupersededImages(messages: ChatMessage[]): void {
    let newestShot = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === "tool" && message.images?.length) {
            newestShot = i;
            break;
        }
    }
    for (const [i, message] of messages.entries()) {
        if (message.role === "tool" && i !== newestShot) message.images = undefined;
    }
}

/**
 * Remove recovery nudges at the end of the history that the model never answered. They are host
 * instructions, not the user's words: left in place, the next turn's real user message merges with
 * them at the API and the model may act on an instruction from a run that is over.
 *
 * Empty assistant turns are pushed every iteration and discarded by every provider. So a nudge is
 * "at the end" even when an empty assistant follows it — the loop has to look past those, or the
 * very case this exists for walks straight through.
 */
export function dropTrailingSynthetic(messages: ChatMessage[]): void {
    while (messages.length > 0) {
        let index = messages.length - 1;
        while (index >= 0 && isEmptyAssistant(messages[index])) index--;
        if (index < 0) return;
        const last = messages[index];
        if (last.role !== "user" || !last.synthetic) return;
        messages.splice(index);
    }
}

/** An assistant turn with nothing a provider would replay. */
function isEmptyAssistant(message: ChatMessage): boolean {
    return message.role === "assistant" && !message.content.trim() && !message.toolCalls?.length;
}

/**
 * Reasoning is replayed to the API as part of the assistant turn that produced it, and the API
 * bills it as input like anything else it is sent: a conversation that keeps every turn's thinking
 * pays for the model's whole reasoning history on every request — on a thinking-heavy model the
 * largest single thing in the window, since one turn's reasoning can run to thousands of tokens.
 *
 * What the API needs is narrower than that: thinking blocks have to precede the tool_use they
 * belong to, so they are required only while the tool loop that produced them is still open. Every
 * earlier turn's can go — the same set the API's own `clear_thinking` edit keeps. This runs once
 * per user turn, at the start of one and before anything of it exists, so the turn in flight keeps
 * its own reasoning and the loop it is in stays valid.
 *
 * The panel's `trimMessages` applies the same rule when a turn begins, so the context it estimates
 * is the one that gets sent.
 */
export function dropSupersededThinking(messages: ChatMessage[]): void {
    // With no user message there is no newer turn to supersede anything, so nothing is dropped —
    // every block in the list may belong to a loop that is still open.
    let boundary = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        // A synthetic nudge belongs to the turn it repairs, not to a newer one.
        if (message.role === "user" && !message.synthetic) {
            boundary = i;
            break;
        }
    }
    for (const [i, message] of messages.entries()) {
        if (i < boundary && message.role === "assistant") message.thinking = undefined;
    }
}
