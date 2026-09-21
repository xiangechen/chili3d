// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Id } from "@chili3d/core";
import type { ImagePart, TokenUsage } from "./llm/types";

/** Where a document keeps its chat history inside `IDocument.userData`. */
const CHAT_KEY = "chats";

/** A tool call as it appears in the transcript: enough to redraw the card, not to replay the call. */
export interface StoredToolCall {
    name: string;
    args: string;
    result?: string;
}

/** A question the assistant asked mid-run, and what came back. */
export interface StoredAsk {
    question: string;
    options?: string[];
    answer: string;
}

/**
 * One piece of an assistant turn, in the order it happened. A turn interleaves paragraphs with
 * the tool cards and questions that interrupted them, so the projection has to stay ordered —
 * a flat `text` beside a `tools` list sorts every tool ahead of every paragraph.
 */
export type StoredPart =
    | { type: "text"; text: string }
    /** Reasoning, kept for the transcript only — it carries no signature and is never replayed. */
    | { type: "thinking"; text: string; ms?: number }
    | ({ type: "tool" } & StoredToolCall)
    | ({ type: "ask" } & StoredAsk);

/**
 * One entry of the visible transcript. This is a *display projection* of the model's
 * conversation, not the conversation itself: thinking blocks are dropped (their signatures
 * cannot be replayed) and a turn's text and tool exchanges are recorded as the ordered
 * `parts` they streamed in as.
 */
export interface StoredMessage {
    role: "user" | "assistant";
    /** The turn's text alone, concatenated — what the copy button and the model context use. */
    text: string;
    /** When the message landed, so a restored transcript keeps its original footer times. */
    time: number;
    images?: ImagePart[];
    /** An assistant turn's ordered content. Absent on user messages. */
    parts?: StoredPart[];
    /** Pre-`parts` layout, read only to restore conversations saved before that change. */
    tools?: StoredToolCall[];
    asks?: StoredAsk[];
    /** Wall-clock milliseconds the turn spent in tool calls, for the "worked for Ns" summary. */
    workedMs?: number;
    /** What the turn cost, summed over its model turns — shown in the footer. */
    usage?: TokenUsage;
}

/**
 * A turn's parts in order. Conversations saved before `parts` existed kept the same content in
 * three flat fields, which lost the interleaving — they are rebuilt in the top-down order the
 * old renderer drew them: tool cards and questions above the reply.
 */
export function messageParts(message: StoredMessage): StoredPart[] {
    if (message.parts) return message.parts;
    return [
        ...(message.tools ?? []).map((tool): StoredPart => ({ type: "tool", ...tool })),
        ...(message.asks ?? []).map((ask): StoredPart => ({ type: "ask", ...ask })),
        ...(message.text ? ([{ type: "text", text: message.text }] as StoredPart[]) : []),
    ];
}

export interface StoredConversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: StoredMessage[];
}

/** First line of the opening message, clipped; empty when that message carried no text. */
export function conversationTitle(text: string): string {
    const line = text.replace(/\s+/g, " ").trim();
    if (!line) return "";
    return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

export function newConversation(): StoredConversation {
    const now = Date.now();
    return { id: Id.generate(), title: "", createdAt: now, updatedAt: now, messages: [] };
}

/**
 * Chat history rides along in the document's own `userData`, so it is written exactly when the
 * document is saved and disappears with it when the document is deleted — no separate table to
 * keep in step, and no write per chat turn.
 */
export function readConversations(document: IDocument): StoredConversation[] {
    const saved = document.userData?.[CHAT_KEY];
    return Array.isArray(saved) ? (saved as StoredConversation[]) : [];
}

export function writeConversations(document: IDocument, conversations: StoredConversation[]): void {
    document.userData ??= {};
    document.userData[CHAT_KEY] = conversations;
}
