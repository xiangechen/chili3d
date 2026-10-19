// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { messageParts, type StoredMessage } from "../history";
import type { ChatMessage, ToolCall } from "./types";

/**
 * What the trimmed history is replaced with. The live document snapshot already answers "what is
 * in the scene"; what a plain trim loses is "what these steps tried, what failed, and what the user
 * decided" — none of which can be re-read from anywhere. So this journal records only those; state
 * reads are dropped silently because a call can always be made again.
 */
export const JOURNAL_MAX_CHARS = 3000;

/** An entry longer than this is a log line, not a record; the model can re-read the tool. */
const ENTRY_MAX_CHARS = 220;

const JOURNAL_HEADER =
    "Folded earlier turns (records only; the live document snapshot above is authoritative).";

export type JournalKind = "build" | "state" | "reference" | "record";

/** Tools whose result is a change worth remembering after the exchange is gone. */
const BUILD_TOOLS = new Set([
    "run_program",
    "run_parametric",
    "transform_node",
    "set_node_properties",
    "set_node_visible",
    "delete_node",
    "move_nodes",
    "create_folder",
    "undo",
    "redo",
    "set_material",
    "set_material_properties",
    "document_variables",
]);

/** Tools whose result is a reading of the scene; a later call can reproduce it. */
const STATE_TOOLS = new Set([
    "get_document_state",
    "get_selection",
    "get_node_properties",
    "get_material",
    "list_materials",
    "get_ribbon",
    "capture_screenshot",
    "capture_views",
    "click_view",
    "select_nodes",
    "fit_content",
    "isolate_view",
    "rotate_view",
    "set_camera_type",
]);

const REFERENCE_TOOLS = new Set(["load_skill"]);

/** Classify by tool name alone: the declared tool is the truth, no heuristics on the content. */
export function classifyTool(name: string): JournalKind {
    if (REFERENCE_TOOLS.has(name)) return "reference";
    if (BUILD_TOOLS.has(name)) return "build";
    if (name === "ask_user" || name === "export_nodes") return "record";
    if (STATE_TOOLS.has(name)) return "state";
    // A tool this list does not know is kept rather than silently forgotten: losing a future
    // modeling tool's record is worse than one extra line. Registering its kind with the tool
    // would be better still; until then the conservative reading wins.
    return "record";
}

/** Turn one tool exchange into a journal entry, or undefined when the exchange is re-derivable. */
function toolEntry(name: string, content: string, call?: ToolCall): string | undefined {
    const kind = classifyTool(name);
    if (kind === "state") return undefined;
    // `document_variables` reads by default; a list is a state reading, not a build.
    if (name === "document_variables" && !variableMutationCall(call)) return undefined;

    // The reference gate pauses a modeling call without failing it. Recorded as FAILED, the model
    // would later read its own history as "that plan broke" even though the retry succeeded.
    if (parseObject<{ blocked?: unknown }>(content)?.blocked) {
        return clip(`- build ${name}: paused for the reference read (not executed)`);
    }

    if (kind === "reference") {
        const skill = argumentName(call, "name");
        return clip(`- reference: ${skill ?? "skill"} (re-load it before relying on it)`);
    }

    if (kind === "record") {
        const label = name === "ask_user" ? "user answer" : name;
        return clip(`- record ${label}: ${content}`);
    }

    const detail =
        name === "run_program"
            ? summarizeProgram(content)
            : name === "run_parametric"
              ? summarizeParametric(content)
              : summarizeGeneric(content);
    // Clip the whole line, names included: a node or feature name is arbitrary model/user text,
    // and a newline in one would forge an entry while an overlong one could evict the journal.
    return clip(`- build ${name}: ${detail}`);
}

/** The shape of a completed program, as capabilityEngine reports it. */
interface ProgramReport {
    error?: unknown;
    created?: { nodeId?: string; name?: string }[];
    removed?: { nodeId?: string; name?: string }[];
    results?: Record<string, unknown>;
}

function summarizeProgram(content: string): string {
    const report = parseObject<ProgramReport>(content);
    if (!report) return clip(content);
    if (typeof report.error === "string") return `FAILED: ${clip(report.error, 160)}`;

    const parts: string[] = [];
    const created = report.created ?? [];
    const removed = report.removed ?? [];
    if (created.length) parts.push(`created ${created.length} (${nodeNames(created)})`);
    if (removed.length) parts.push(`removed ${removed.length} (${nodeNames(removed)})`);
    const resultKeys = Object.keys(report.results ?? {});
    if (resultKeys.length) {
        const shown = resultKeys.slice(0, 8).join(", ");
        parts.push(`results ${shown}${resultKeys.length > 8 ? ", …" : ""}`);
    }
    return parts.length ? parts.join("; ") : "ok";
}

/** The shape a parametric program reports: bodies carry the feature lists that must survive a trim. */
interface ParametricReport {
    error?: unknown;
    created?: { nodeId?: string; name?: string }[];
    bodies?: { nodeId?: string; name?: string; features?: { type?: string; display?: string }[] }[];
    consumed?: { nodeId?: string; name?: string }[];
    results?: Record<string, unknown>;
}

function summarizeParametric(content: string): string {
    const report = parseObject<ParametricReport>(content);
    if (!report) return clip(content);
    if (typeof report.error === "string") return `FAILED: ${clip(report.error, 160)}`;

    const parts: string[] = [];
    const bodies = report.bodies ?? [];
    if (bodies.length) {
        const shown = bodies.slice(0, 3).map((body) => {
            const features = (body.features ?? []).slice(0, 5).map((f) => f.display ?? f.type ?? "?");
            const more = (body.features?.length ?? 0) > 5 ? ", …" : "";
            return `${body.name ?? body.nodeId ?? "?"} [${features.join(", ")}${more}]`;
        });
        parts.push(`bodies ${bodies.length} (${shown.join("; ")}${bodies.length > 3 ? "; …" : ""})`);
    }
    if (report.created?.length) parts.push(`created ${report.created.length} (${nodeNames(report.created)})`);
    if (report.consumed?.length)
        parts.push(`consumed ${report.consumed.length} (${nodeNames(report.consumed)})`);
    const resultKeys = Object.keys(report.results ?? {});
    if (resultKeys.length) {
        parts.push(`results ${resultKeys.slice(0, 8).join(", ")}${resultKeys.length > 8 ? ", …" : ""}`);
    }
    return parts.length ? parts.join("; ") : "ok";
}

function summarizeGeneric(content: string): string {
    const value = parseObject<{ error?: unknown }>(content);
    if (typeof value?.error === "string") return `FAILED: ${clip(value.error, 160)}`;
    return "ok";
}

function nodeNames(nodes: { nodeId?: string; name?: string }[]): string {
    const shown = nodes.slice(0, 5).map((n) => n.name ?? n.nodeId ?? "?");
    return shown.join(", ") + (nodes.length > 5 ? ", …" : "");
}

function parseObject<T>(text: string): T | undefined {
    try {
        const value: unknown = JSON.parse(text);
        return value && typeof value === "object" ? (value as T) : undefined;
    } catch {
        return undefined;
    }
}

/** Whether a `document_variables` call writes (set/remove), as opposed to the default list. */
function variableMutationCall(call: ToolCall | undefined): boolean {
    const args = call ? parseObject<Record<string, unknown>>(call.arguments) : undefined;
    const action = args?.["action"];
    return action === "set" || action === "remove";
}

/** A named tool argument, for tools whose meaning is in their input (`load_skill`). */
function argumentName(call: ToolCall | undefined, key: string): string | undefined {
    const args = call ? parseObject<Record<string, unknown>>(call.arguments) : undefined;
    const value = args?.[key];
    return typeof value === "string" ? value : undefined;
}

function clip(text: string, max = ENTRY_MAX_CHARS): string {
    const oneLine = text.replace(/\s+/g, " ").trim();
    if (!oneLine) return "(empty)";
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Whether this assistant message closes its turn — the answer, not one round of the tool loop. */
function closesTurn(messages: ChatMessage[], index: number): boolean {
    const next = messages[index + 1];
    // A synthetic nudge (truncation continue, lost-call retry) belongs to the same turn; treating
    // it as a boundary would record a half-written fragment as the turn's final answer.
    return next === undefined || (next.role === "user" && !next.synthetic);
}

/**
 * Entries for a slice of the model conversation the trim is about to drop. The user's intent and
 * each turn's closing answer are kept; intermediate narration is not — the journal is a record,
 * not a transcript.
 */
export function journalEntriesFromMessages(messages: ChatMessage[]): string[] {
    const calls = new Map<string, ToolCall>();
    for (const message of messages) {
        if (message.role !== "assistant") continue;
        for (const call of message.toolCalls ?? []) calls.set(call.id, call);
    }

    const entries: string[] = [];
    for (const [index, message] of messages.entries()) {
        if (message.role === "user") {
            if (message.synthetic) continue;
            const image = message.images?.length ? "[reference image]" : "";
            const text = message.content.trim() ? clip(message.content) : "";
            const detail = [text, image].filter(Boolean).join(" ");
            if (detail) entries.push(`- user: ${detail}`);
        } else if (message.role === "tool") {
            const entry = toolEntry(message.name, message.content, calls.get(message.toolCallId));
            if (entry) entries.push(entry);
        } else if (message.content.trim() && !message.toolCalls?.length && closesTurn(messages, index)) {
            entries.push(`- assistant: ${clip(message.content)}`);
        }
    }
    return entries;
}

/**
 * Entries for the turns a restored conversation no longer carries in the model history. Those are
 * the only turns this journal is for: a turn still in `messages` also has its tool exchanges, so
 * recording it here would put the same result in the prompt twice (the revert path did exactly
 * that). Dropped turns are emitted in conversation order; the newest survive a budget cut.
 */
function storedJournalEntries(messages: StoredMessage[], droppedTurns: number): string[] {
    const entries: string[] = [];
    let turn = -1;

    for (const message of messages) {
        if (message.role === "user") {
            turn++;
            if (turn < droppedTurns) {
                const image = message.images?.length ? "[reference image]" : "";
                const text = message.text.trim() ? clip(message.text) : "";
                const detail = [text, image].filter(Boolean).join(" ");
                if (detail) entries.push(`- user: ${detail}`);
            }
            continue;
        }
        if (turn < 0 || turn >= droppedTurns) continue;
        for (const part of messageParts(message)) {
            if (part.type === "tool") {
                const entry = toolEntry(part.name, part.result ?? "", {
                    id: part.name,
                    name: part.name,
                    arguments: part.args,
                });
                if (entry) entries.push(entry);
            } else if (part.type === "ask") {
                entries.push(`- record user answer: ${clip(part.answer)}`);
            }
        }
        if (message.text.trim()) entries.push(`- assistant: ${clip(message.text)}`);
    }
    return entries;
}

/** Join entries onto an existing journal, dropping the oldest whole lines until it fits. */
export function mergeJournal(previous: string, entries: string[], maxChars = JOURNAL_MAX_CHARS): string {
    const lines = [...journalLines(previous), ...entries].filter((line) => line.trim());
    if (lines.length === 0) return "";

    let kept = lines;
    let omitted = 0;
    while (kept.length > 0 && journalLength(kept, omitted) > maxChars) {
        kept = kept.slice(1);
        omitted++;
    }
    return `${JOURNAL_HEADER}${entryMarker(omitted)}\n${kept.join("\n")}`;
}

/** A journal rebuilt from the turns a restored conversation no longer carries. */
export function journalFromStored(
    messages: StoredMessage[],
    droppedTurns = 0,
    maxChars = JOURNAL_MAX_CHARS,
): string {
    return mergeJournal("", storedJournalEntries(messages, droppedTurns), maxChars);
}

/** The one place the "how much was dropped" marker is written. */
function entryMarker(omitted: number): string {
    return omitted ? `\n(${omitted} earlier entries omitted)` : "";
}

/** The same marker, as read back off an existing journal. */
const ENTRY_MARKER_PATTERN = /^\(\d+ earlier entries omitted\)$/;

function journalLength(lines: string[], omitted: number): number {
    return JOURNAL_HEADER.length + entryMarker(omitted).length + 1 + lines.join("\n").length;
}

function journalLines(journal: string): string[] {
    if (!journal.trim()) return [];
    return journal
        .split("\n")
        .filter((line) => line !== JOURNAL_HEADER && !ENTRY_MARKER_PATTERN.test(line.trim()));
}
