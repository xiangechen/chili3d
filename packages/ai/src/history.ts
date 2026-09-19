// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Id } from "@chili3d/core";
import type { ImagePart } from "./llm/types";

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
 * One entry of the visible transcript. This is a *display projection* of the model's
 * conversation, not the conversation itself: thinking blocks are dropped (their signatures
 * cannot be replayed) and a turn's tool exchanges collapse into `tools` on the assistant
 * message they belong to.
 */
export interface StoredMessage {
    role: "user" | "assistant";
    text: string;
    /** When the message landed, so a restored transcript keeps its original footer times. */
    time: number;
    images?: ImagePart[];
    tools?: StoredToolCall[];
    /** Questions asked during the turn, in order. Their own shape — not folded tool cards. */
    asks?: StoredAsk[];
    /** Wall-clock milliseconds the turn spent in tool calls, for the "worked for Ns" summary. */
    workedMs?: number;
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
