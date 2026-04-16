import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
    type AssistantModelMessage,
    type ModelMessage,
    stepCountIs,
    streamText,
    tool,
    type ToolModelMessage,
} from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { executeTool, schemas, SYSTEM_PROMPT, toolDescriptions, type ToolName } from "../tools";
import { clearChat, loadChat, saveChat } from "./chat-store";
import { SettingsDialog } from "./SettingsDialog";
import type { ApiKey } from "./storage";
import { allToolNames, loadDisabled } from "./tool-settings";
import { useActiveDocumentId } from "./useActiveDocument";

type PartText = { type: "text"; text: string };
type PartToolCall = {
    type: "tool";
    id: string;
    name: string;
    input: unknown;
    status: "running" | "done" | "error";
    result?: unknown;
    error?: string;
};
type Part = PartText | PartToolCall;

type DisplayGroup =
    | { kind: "user"; text: string }
    | { kind: "assistant"; parts: Part[] };

const SUGGESTED_PROMPTS = [
    "Design a 100×80×5mm plate with a 25mm central hole and four 6mm mounting holes inset 10mm from each corner.",
    "Draw an L-bracket: legs 60×40×3mm with a 5mm fillet on the inside corner and two 4mm mounting holes in each leg.",
    "Build a snowman: three stacked spheres along +Z (radii 40, 30, 22mm), a small orange cone nose, and two tiny black sphere eyes.",
    "Build a minecraft creeper. Use a bunch of small cubes assembled together to achieve the blocky effect rather than a small number of large prisms for the body etc.",
    "Show me the top view, then the isometric view.",
];

function buildTools(disabled: Set<ToolName>) {
    const entries = allToolNames()
        .filter((name) => !disabled.has(name))
        .map((name) => {
            const schema = schemas[name] as z.ZodTypeAny;
            return [
                name,
                tool({
                    description: toolDescriptions[name],
                    inputSchema: schema,
                    execute: async (input) => {
                        return await executeTool(name, input);
                    },
                    // `capture_view` returns an image: forward the raw bytes to
                    // the provider as a media tool-result so Claude / GPT can
                    // actually see it. Everything else uses the SDK's default
                    // (JSON.stringify of the execute return) — returning
                    // undefined here lets the default path handle it.
                    toModelOutput: (output) => toModelOutputFor(name, output),
                }),
            ] as const;
        });
    return Object.fromEntries(entries);
}

// Match the SDK's LanguageModelV2ToolResultOutput — one of a handful of
// discriminated shapes. We only use `content` (for images) and `json` (the
// default for every other tool).
type ToolOutput = Parameters<
    NonNullable<Parameters<typeof tool>[0]["toModelOutput"]>
>[0] extends infer _Input
    ? ReturnType<NonNullable<Parameters<typeof tool>[0]["toModelOutput"]>>
    : never;

function toModelOutputFor(name: ToolName, output: unknown): ToolOutput {
    if (name === "capture_view") {
        const img = (output as { image?: { mediaType?: string; data?: string } })?.image;
        if (img?.data && img?.mediaType) {
            return {
                type: "content",
                value: [
                    { type: "media", data: img.data, mediaType: img.mediaType },
                    // JSON sidecar with dimensions + camera state so the model
                    // doesn't have to call get_camera_state right after.
                    { type: "text", text: JSON.stringify(stripImage(output), null, 2) },
                ],
            };
        }
    }
    // Default: every other tool returns JSON. Round-trip through
    // JSON.stringify/parse to drop any `undefined` fields an executor
    // might have left in the result — jsonValueSchema rejects undefined
    // when the history is re-validated on subsequent turns, and it's not
    // worth sprinkling undefined-guards across every executor.
    const safe = JSON.parse(JSON.stringify(output ?? null));
    return { type: "json", value: safe };
}

function stripImage(output: unknown): unknown {
    if (!output || typeof output !== "object") return output;
    const clone = { ...(output as Record<string, unknown>) };
    const img = clone.image as { mediaType?: string; width?: number; height?: number } | undefined;
    if (img) {
        // Drop the heavy base64 from the JSON sidecar — the image is already
        // shipped as a media part above.
        clone.image = { mediaType: img.mediaType, width: img.width, height: img.height };
    }
    return clone;
}

function buildModel(api: ApiKey) {
    const id = api.model?.trim() || undefined;
    if (api.provider === "anthropic") {
        const provider = createAnthropic({
            apiKey: api.key,
            headers: { "anthropic-dangerous-direct-browser-access": "true" },
        });
        return provider(id ?? "claude-sonnet-4-5");
    }
    const provider = createOpenAI({ apiKey: api.key });
    return provider(id ?? "gpt-4o-mini");
}

/**
 * Build display groups from the canonical ModelMessage history.
 *
 * The SDK emits interleaved assistant/tool messages (one pair per step). For
 * rendering we fold tool-result blocks back into the tool-call they answer,
 * and coalesce consecutive assistant messages into a single "assistant turn"
 * so the UI reads like one continuous reply.
 */
function toDisplayGroups(history: ModelMessage[]): DisplayGroup[] {
    const toolResults = new Map<string, { result?: unknown; error?: string }>();
    for (const m of history) {
        if (m.role !== "tool") continue;
        const msg = m as ToolModelMessage;
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (block.type !== "tool-result") continue;
            const output = block.output;
            if (output && typeof output === "object" && "type" in output) {
                if (output.type === "error-text") {
                    toolResults.set(block.toolCallId, { error: String(output.value ?? "") });
                    continue;
                }
                if ("value" in output) {
                    toolResults.set(block.toolCallId, { result: output.value });
                    continue;
                }
            }
            toolResults.set(block.toolCallId, { result: output });
        }
    }

    const groups: DisplayGroup[] = [];
    let currentAssistant: Extract<DisplayGroup, { kind: "assistant" }> | null = null;

    for (const m of history) {
        if (m.role === "user") {
            const text =
                typeof m.content === "string"
                    ? m.content
                    : Array.isArray(m.content)
                      ? m.content
                            .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
                            .join("")
                      : "";
            groups.push({ kind: "user", text });
            currentAssistant = null;
            continue;
        }
        if (m.role !== "assistant") continue;
        const msg = m as AssistantModelMessage;
        if (!currentAssistant) {
            currentAssistant = { kind: "assistant", parts: [] };
            groups.push(currentAssistant);
        }
        const blocks = Array.isArray(msg.content)
            ? msg.content
            : [{ type: "text" as const, text: String(msg.content ?? "") }];
        for (const block of blocks) {
            if (block.type === "text") {
                const last = currentAssistant.parts[currentAssistant.parts.length - 1];
                if (last && last.type === "text") {
                    last.text += block.text;
                } else {
                    currentAssistant.parts.push({ type: "text", text: block.text });
                }
            } else if (block.type === "tool-call") {
                const res = toolResults.get(block.toolCallId);
                currentAssistant.parts.push({
                    type: "tool",
                    id: block.toolCallId,
                    name: block.toolName,
                    input: block.input,
                    status: res?.error ? "error" : res ? "done" : "running",
                    result: res?.result,
                    error: res?.error,
                });
            }
        }
    }
    return groups;
}

export function ChatPanel({
    apiKey,
    onApiKeyChange,
}: {
    apiKey: ApiKey;
    onApiKeyChange: (next: ApiKey) => void;
}) {
    const docId = useActiveDocumentId();
    const [history, setHistory] = useState<ModelMessage[]>([]);
    const [streamingParts, setStreamingParts] = useState<Part[] | null>(null);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [disabledTools, setDisabledTools] = useState<Set<ToolName>>(() => loadDisabled());
    const scroller = useRef<HTMLDivElement>(null);
    const abort = useRef<AbortController | null>(null);
    // Guards against races when the user switches documents mid-turn: any
    // async save from the previous doc becomes a no-op.
    const loadedDocRef = useRef<string | null>(null);

    const tools = useMemo(() => buildTools(disabledTools), [disabledTools]);
    const model = useMemo(() => buildModel(apiKey), [apiKey]);

    // Load transcript when the active document changes.
    //
    // Two things to guard against:
    //   1. Mid-turn doc swaps (e.g. AI calls `new_document` → `activeViewChanged`
    //      fires before the stream finishes). Skip while `busy` so we don't
    //      blank the chat.
    //   2. Spurious re-runs when `busy` flips back to false. Without this
    //      guard, every send completion re-loaded the current doc from IDB
    //      and raced with the async `saveChat` the send had just fired —
    //      occasionally overwriting freshly-streamed messages with a stale
    //      pre-turn snapshot.
    useEffect(() => {
        if (busy) return;
        if (loadedDocRef.current === docId) return;
        let cancelled = false;
        setError(null);
        setStreamingParts(null);
        loadedDocRef.current = null;
        (async () => {
            const messages = await loadChat(docId);
            if (cancelled) return;
            setHistory(messages);
            loadedDocRef.current = docId;
        })();
        return () => {
            cancelled = true;
        };
    }, [docId, busy]);

    // Persist on every history change — but only once the initial load for
    // this document has completed, so we don't wipe the stored transcript
    // with the empty initial state.
    useEffect(() => {
        if (loadedDocRef.current !== docId) return;
        void saveChat(docId, history);
    }, [docId, history]);

    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    }, [history, streamingParts]);

    const send = useCallback(async (overrideText?: string) => {
        const text = (overrideText ?? input).trim();
        if (!text || busy) return;
        setError(null);
        if (!overrideText) setInput("");
        // Capture the doc id at the moment the user sends. The AI may swap
        // the active view mid-turn (via `new_document`), in which case the
        // finished transcript still conceptually belongs to this doc.
        const sendingDocId = docId;
        const userMsg: ModelMessage = { role: "user", content: text };
        const next: ModelMessage[] = [...history, userMsg];
        setHistory(next);
        setBusy(true);
        abort.current = new AbortController();

        const live: Part[] = [];
        const pushLive = () => setStreamingParts([...live]);
        pushLive();

        let responsePromise: Promise<{ messages: ModelMessage[] }> | null = null;
        try {
            const result = streamText({
                model,
                system: SYSTEM_PROMPT,
                messages: next,
                tools,
                stopWhen: stepCountIs(8),
                abortSignal: abort.current.signal,
            });
            responsePromise = result.response as Promise<{ messages: ModelMessage[] }>;

            let currentText: PartText | null = null;
            for await (const event of result.fullStream) {
                switch (event.type) {
                    case "text-delta": {
                        if (!currentText) {
                            currentText = { type: "text", text: "" };
                            live.push(currentText);
                        }
                        currentText.text += event.text;
                        pushLive();
                        break;
                    }
                    case "tool-call": {
                        currentText = null;
                        live.push({
                            type: "tool",
                            id: event.toolCallId,
                            name: event.toolName,
                            input: event.input,
                            status: "running",
                        });
                        pushLive();
                        break;
                    }
                    case "tool-result": {
                        const part = live.find(
                            (p): p is PartToolCall =>
                                p.type === "tool" && p.id === event.toolCallId,
                        );
                        if (part) {
                            part.status = "done";
                            part.result = event.output;
                        }
                        pushLive();
                        break;
                    }
                    case "tool-error": {
                        const part = live.find(
                            (p): p is PartToolCall =>
                                p.type === "tool" && p.id === event.toolCallId,
                        );
                        if (part) {
                            part.status = "error";
                            part.error =
                                event.error instanceof Error
                                    ? event.error.message
                                    : String(event.error);
                        }
                        pushLive();
                        break;
                    }
                    case "error":
                        throw event.error instanceof Error
                            ? event.error
                            : new Error(String(event.error));
                    case "finish-step":
                        currentText = null;
                        break;
                    default:
                        break;
                }
            }

            // Canonical source of truth: the full ordered list of messages the
            // SDK produced across all steps. Appending these preserves the
            // strict assistant→tool interleaving Anthropic requires.
            const response = await responsePromise;
            setHistory((h) => [...h, ...response.messages]);
            setStreamingParts(null);
            // Explicit save to the originating doc in case docId has changed
            // during the stream (the per-history useEffect saves to the
            // *current* docId, which would miss the new doc if the AI just
            // created one).
            void saveChat(sendingDocId, [...next, ...response.messages]);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
            if (responsePromise) {
                try {
                    const response = await responsePromise;
                    setHistory((h) => [...h, ...response.messages]);
                } catch {}
            }
            setStreamingParts(null);
        } finally {
            setBusy(false);
            abort.current = null;
        }
    }, [history, input, busy, model, tools]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
        }
    };

    const groups = useMemo(() => toDisplayGroups(history), [history]);
    const displayGroups = streamingParts
        ? [...groups, { kind: "assistant" as const, parts: streamingParts }]
        : groups;

    // Two-click confirm for Clear — first click arms the button (it swaps to
    // "Confirm?"), second click within the window actually clears. Avoids an
    // ugly native confirm() dialog without needing a full modal.
    const [clearArmed, setClearArmed] = useState(false);
    const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (clearTimer.current) clearTimeout(clearTimer.current);
    }, []);

    const onClearChat = useCallback(async () => {
        if (busy) return;
        if (!clearArmed) {
            setClearArmed(true);
            if (clearTimer.current) clearTimeout(clearTimer.current);
            clearTimer.current = setTimeout(() => setClearArmed(false), 3000);
            return;
        }
        if (clearTimer.current) clearTimeout(clearTimer.current);
        setClearArmed(false);
        await clearChat(docId);
        setHistory([]);
        setStreamingParts(null);
        setError(null);
    }, [busy, clearArmed, docId]);

    return (
        <div className="app">
            <header className="header">
                <div className="title">
                    <AssistantIcon />
                    <div>
                        <h1>AI Assistant</h1>
                        <div className="meta">
                            {apiKey.provider} · {apiKey.model || "default"}
                        </div>
                    </div>
                </div>
                <div className="header-actions">
                    <button
                        className={`ghost${clearArmed ? " armed" : ""}`}
                        onClick={onClearChat}
                        title={clearArmed ? "Click again to confirm" : "Clear this document's chat"}
                    >
                        {clearArmed ? "Confirm?" : "Clear"}
                    </button>
                    <button
                        className="icon-btn"
                        onClick={() => setSettingsOpen(true)}
                        title="AI settings"
                        aria-label="AI settings"
                    >
                        <GearIcon />
                    </button>
                </div>
            </header>

            <div className="messages" ref={scroller}>
                {displayGroups.length === 0 && (
                    <div className="msg">
                        <div className="role">Assistant</div>
                        <div className="bubble">Hi! Tell me what to build. Try:</div>
                        <div className="prompt-suggestions">
                            {SUGGESTED_PROMPTS.map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    className="prompt-suggestion"
                                    disabled={busy}
                                    onClick={() => void send(p)}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {displayGroups.map((g, i) => (
                    <GroupView key={i} group={g} />
                ))}
                {busy && <BusyIndicator />}
            </div>

            {error && <div className="err">{error}</div>}

            <form
                className="composer"
                onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                }}
            >
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={
                        displayGroups.length === 0
                            ? "Describe what you want to build..."
                            : "Reply..."
                    }
                    disabled={busy}
                />
                <button type="submit" disabled={busy || !input.trim()}>
                    {busy ? "…" : "Send"}
                </button>
            </form>
            {settingsOpen && (
                <SettingsDialog
                    current={apiKey}
                    onSaved={onApiKeyChange}
                    disabledTools={disabledTools}
                    onDisabledToolsChange={setDisabledTools}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
        </div>
    );
}

function GearIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M19.14 12.94c.04-.3.06-.62.06-.94s-.02-.64-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.484.484 0 0 0 13.94 2h-3.84c-.24 0-.43.17-.47.41L9.27 4.95c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.47c-.12.21-.08.47.12.61l2.03 1.58c-.04.3-.06.62-.06.94s.02.64.06.94L2.87 14.12a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.02-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
        </svg>
    );
}

function BusyIndicator() {
    return (
        <div className="busy-indicator" role="status" aria-label="thinking">
            <span className="busy-dot" />
            <span className="busy-dot" />
            <span className="busy-dot" />
        </div>
    );
}

function AssistantIcon() {
    return (
        <svg
            className="assistant-icon"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="M12 2.5l2.2 5.8 5.8 2.2-5.8 2.2L12 18.5l-2.2-5.8L4 10.5l5.8-2.2L12 2.5z" />
            <path
                d="M18.5 14l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2z"
                opacity="0.7"
            />
        </svg>
    );
}

function GroupView({ group }: { group: DisplayGroup }) {
    if (group.kind === "user") {
        return (
            <div className="msg user">
                <div className="role">You</div>
                <div className="bubble">{group.text}</div>
            </div>
        );
    }
    return (
        <div className="msg">
            <div className="role">Assistant</div>
            {group.parts.map((p, i) =>
                p.type === "text" ? (
                    <div className="bubble" key={i}>
                        {p.text}
                    </div>
                ) : (
                    <ToolView key={i} part={p} />
                ),
            )}
        </div>
    );
}

function ToolView({ part }: { part: PartToolCall }) {
    // Collapsed by default — errors auto-open so the user sees the failure
    // without having to click. We build a short one-line preview of the input
    // for the summary so the call is still legible while collapsed.
    const preview = inlinePreview(part.input);
    const statusLabel =
        part.status === "running" ? "running…" : part.status === "error" ? "error" : "ok";
    const imageSrc = part.status === "done" ? extractImageSrc(part.result) : null;
    return (
        <details className={`tool ${part.status === "error" ? "error" : ""}`} open={part.status === "error"}>
            <summary>
                <span className="tool-name">{part.name}</span>
                {preview && <span className="tool-preview">{preview}</span>}
                <span className="tool-status">{statusLabel}</span>
            </summary>
            <pre>{JSON.stringify(part.input, null, 2)}</pre>
            {part.status !== "running" && (
                <pre>
                    {part.status === "error"
                        ? part.error
                        : JSON.stringify(resultForDisplay(part.result), null, 2)}
                </pre>
            )}
            {imageSrc && <img className="tool-screenshot" src={imageSrc} alt="viewport screenshot" />}
        </details>
    );
}

function extractImageSrc(result: unknown): string | null {
    // Streaming/executor shape: { image: { data, mediaType, ... }, camera: ... }
    const direct = (result as { image?: { mediaType?: string; data?: string } })?.image;
    if (direct?.data && direct?.mediaType) return `data:${direct.mediaType};base64,${direct.data}`;
    // History shape: the SDK stores whatever toModelOutput returned. For
    // capture_view that's `{ type: "content", value: [...] }`; toDisplayGroups
    // unwraps `output.value`, leaving us with the content-part array.
    if (Array.isArray(result)) {
        for (const p of result) {
            if (
                p &&
                typeof p === "object" &&
                (p as { type?: string }).type === "media" &&
                typeof (p as { data?: unknown }).data === "string" &&
                typeof (p as { mediaType?: unknown }).mediaType === "string"
            ) {
                const m = p as { data: string; mediaType: string };
                return `data:${m.mediaType};base64,${m.data}`;
            }
        }
    }
    return null;
}

// For display only: hide the heavy base64 behind a short placeholder so the
// JSON pane is readable.
function resultForDisplay(result: unknown): unknown {
    if (Array.isArray(result)) {
        return result.map((p) => {
            if (
                p &&
                typeof p === "object" &&
                (p as { type?: string }).type === "media" &&
                typeof (p as { data?: unknown }).data === "string"
            ) {
                const m = p as { type: "media"; data: string; mediaType?: string };
                return {
                    type: "media",
                    mediaType: m.mediaType,
                    data: `[${Math.ceil((m.data.length * 3) / 4 / 1024)} KB omitted]`,
                };
            }
            return p;
        });
    }
    if (!result || typeof result !== "object") return result;
    const r = result as Record<string, unknown>;
    const img = r.image as { data?: string; mediaType?: string; width?: number; height?: number } | undefined;
    if (!img?.data) return result;
    return {
        ...r,
        image: {
            mediaType: img.mediaType,
            width: img.width,
            height: img.height,
            data: `[${Math.ceil((img.data.length * 3) / 4 / 1024)} KB omitted]`,
        },
    };
}

function inlinePreview(input: unknown): string {
    if (input == null || typeof input !== "object") return "";
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) return "";
    const s = entries
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(" ");
    return s.length > 60 ? `${s.slice(0, 58)}…` : s;
}

function formatValue(v: unknown): string {
    if (Array.isArray(v)) return `[${v.length}]`;
    if (v === null) return "null";
    if (typeof v === "string") return v.length > 14 ? `"${v.slice(0, 12)}…"` : `"${v}"`;
    if (typeof v === "object") return "{…}";
    return String(v);
}
