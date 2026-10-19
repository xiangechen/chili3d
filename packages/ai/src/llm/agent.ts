// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys } from "@chili3d/core";
import type { LLMConfig } from "../settings";
import { dropSupersededImages, dropSupersededThinking } from "./messages";
import { createProvider } from "./provider";
import type {
    ChatMessage,
    ImagePart,
    LLMProvider,
    StreamEvent,
    SystemPrompt,
    ThinkingBlock,
    TokenUsage,
    Tool,
    ToolCall,
} from "./types";

export interface ChatCallbacks {
    onTextDelta(text: string): void;
    /** Reasoning as it streams, for the UI to show while the model is still thinking. */
    onThinkingDelta(text: string): void;
    onToolCall(call: { name: string; arguments: string; result?: string }): void;
    /** What one model turn cost, reported once per streamed turn. */
    onUsage(usage: TokenUsage): void;
    /**
     * A batch of tool calls is about to run. The reference gate uses this to tell "another call
     * in the batch that was just blocked" from "the model has seen the result and is retrying";
     * the boundary belongs to the loop that forms the batch, not to its callers.
     */
    onToolBatchStart?(): void;
}

/**
 * Upper bound on model<->tool round trips per run, so a stuck tool loop cannot spin forever.
 *
 * A round trip carries as many calls as one response asks for — the flags that used to hold it to
 * one are gone (anthropic.ts, completions.ts) — so this budget counts trips, and a trip is worth
 * whatever the model puts in it. What it has to leave room for: a verified edit is about six of
 * them (screenshot, click_view + verify, run_program, select, fit, screenshot), a build with a few
 * retries spends that again, and reading the plan off a skill costs a few more. 100 leaves that
 * room; the guard is still a ceiling and not a target — a run that reaches it has spent real
 * money, which is why it is not higher.
 */
export const MAX_AGENT_ITERATIONS = 100;

/**
 * How many times a turn cut off by the output limit is asked to carry on. One covers the ordinary
 * case (a long answer or a plan that ran past the ceiling); a second covers an answer that needs
 * another run at it. Three would be the model spending its budget over and over — at 65535 output
 * tokens a round, that is not a retry, it is the same bill twice.
 */
export const MAX_TRUNCATION_CONTINUES = 2;

/**
 * How many times a turn that claimed a call and delivered none is asked to send it again. Mistyped
 * or dropped tool-call payloads are a transport/model hiccup, not an answer: ending the run there
 * throws away everything the user asked for. The bound is separate from truncation (a different
 * failure with a different remedy) and both share the overall iteration ceiling.
 */
export const MAX_LOST_CALL_NUDGES = 8;

/**
 * How many times a turn that only narrated its intent is pushed to act. One is usually enough; the
 * ceiling exists so a model that keeps promising and never calling ends the turn instead of
 * burning the step budget.
 */
export const MAX_IDLE_NUDGES = 3;

/**
 * Addressed to the model, not to the user, so it stays out of i18n — the same rule as
 * ASK_INTERRUPTED. The second sentence is the one that matters for a model that plans its whole
 * task in one head: it is asked to act, because that is what the next request has room for.
 */
const CONTINUE_AFTER_TRUNCATION =
    "Your last message was cut off by the output limit before it produced an answer or a tool call. " +
    "Continue from where it stopped, without repeating what you already said. If you have not " +
    "started the work yet, make a tool call now rather than planning further.";

/**
 * Recovery text for a stop reason that promised a tool call and carried none. It states only what
 * happened; it does not claim the user asked for anything (see the fabricated-consent note in the
 * narration nudge below).
 */
const NUDGE_AFTER_LOST_CALL =
    "Your previous turn reported that a tool call was coming, but its payload arrived empty. " +
    "Re-issue the same tool call now, with no further prose.";

/**
 * Recovery text for a turn that described what it was about to do and then stopped. The nudge must
 * not read like user approval: a non-anchored or eager rule used to fire on ordinary answers and
 * the fabricated consent changed what the model did next.
 */
const NUDGE_AFTER_PROMISE =
    "Your previous turn described an action but made no tool call. Make the tool call now, with no " +
    "further prose.";

/** What one streamed model turn produced — what the loop reads, and `endingOf` judges. */
interface TurnParts {
    text: string;
    toolCalls: ToolCall[];
    thinking: ThinkingBlock[];
    /** Why the model stopped — the one thing that tells a cut-off turn from an empty answer. */
    stopReason?: string;
}

interface RunAgentOptions {
    config: LLMConfig;
    system: SystemPrompt;
    messages: ChatMessage[];
    tools: Tool[];
    callbacks: ChatCallbacks;
    signal?: AbortSignal;
    provider?: LLMProvider;
    /**
     * Shrink the history after the endpoint rejected it as too long. `limit` is the window the
     * endpoint itself named, when its error named one. Returns whether anything was actually
     * dropped — retrying when it was not would send the same oversized request again.
     */
    compact?(reason: "context-overflow", limit?: number): boolean;
    /**
     * Rebuild the system prompt after compaction. Condensing the history also condenses it into
     * the prompt's volatile section, so a retry that kept the old prompt would not see the record.
     */
    refreshSystem?(): SystemPrompt;
}

type ToolOutput = { toolCallId: string; name: string; content: string; images?: ImagePart[] };

export { createProvider } from "./provider";

export async function runAgent(opts: RunAgentOptions): Promise<void> {
    const provider = opts.provider ?? createProvider(opts.config);
    // A new user turn is under way: what the last one thought is no longer replayed (see
    // dropSupersededThinking), so every request below is spared it.
    dropSupersededThinking(opts.messages);

    const state: RecoveryState = { continues: 0, lostCalls: 0, idleNudges: 0 };
    // Whether the attempt in flight has already put text on screen. A retry after a context
    // overflow would replay that text, so the retry is only allowed before the first delta.
    let emittedText = false;
    let overflowRetried = false;
    const callbacks: ChatCallbacks = {
        ...opts.callbacks,
        onTextDelta: (text) => {
            emittedText = true;
            opts.callbacks.onTextDelta(text);
        },
    };
    const runOpts: RunAgentOptions = { ...opts, callbacks };

    try {
        for (let iteration = 0; ; iteration++) {
            if (opts.signal?.aborted) break;
            if (iteration >= MAX_AGENT_ITERATIONS) {
                // Always say so: the run stops wherever the plan happened to be, and this message
                // is the only thing telling the user it was a limit rather than a finished answer.
                callbacks.onTextDelta(I18n.translate("ai.stepLimit"));
                break;
            }
            emittedText = false;

            let turn: TurnParts;
            try {
                turn = await streamTurn(provider, runOpts);
            } catch (err) {
                if (opts.signal?.aborted) return;
                if (!overflowRetried && !emittedText && isContextOverflowError(err) && opts.compact) {
                    overflowRetried = true;
                    if (opts.compact("context-overflow", contextLimitFromError(err))) {
                        const refreshed = opts.refreshSystem?.();
                        if (refreshed) runOpts.system = refreshed;
                        continue;
                    }
                }
                throw err;
            }

            runOpts.messages.push(assistantMessage(turn.text, turn.toolCalls, turn.thinking));
            const ending = endingOf(turn, state);
            if (ending.notice !== undefined) callbacks.onTextDelta(I18n.translate(ending.notice));

            if (ending.kind === "continue") {
                state.continues++;
                runOpts.messages.push({ role: "user", content: CONTINUE_AFTER_TRUNCATION, synthetic: true });
                continue;
            }
            if (ending.kind === "lost-call") {
                state.lostCalls++;
                runOpts.messages.push({ role: "user", content: NUDGE_AFTER_LOST_CALL, synthetic: true });
                continue;
            }
            if (ending.kind === "idle") {
                state.idleNudges++;
                runOpts.messages.push({ role: "user", content: NUDGE_AFTER_PROMISE, synthetic: true });
                continue;
            }
            if (turn.toolCalls.length === 0) break;

            const results = await runToolCalls(runOpts, turn.toolCalls);
            // The user may have switched conversations while a tool was running. Appending now
            // would put a tool_result into whatever history the panel installed in the meantime.
            if (opts.signal?.aborted) break;
            appendToolResults(runOpts, results);
        }
    } catch (err) {
        // The SDKs surface user cancellation as an AbortError mid-stream; treat it as a clean stop.
        if (opts.signal?.aborted) return;
        throw err;
    }
}

/**
 * The reasons a turn stops short of an answer, in the vocabulary each provider uses. Anthropic
 * says `max_tokens`, the completions API says `length`, the Responses API reports the state
 * `incomplete`; and a turn that claimed a call is coming says `tool_use` / `tool_calls`.
 */
const TRUNCATED = new Set(["max_tokens", "length", "incomplete"]);
const TOOL_STOPS = new Set(["tool_use", "tool_calls"]);
/** Both kinds of stop that leave the user without the answer the turn was for. */
const SHORT_STOPS = new Set([...TRUNCATED, ...TOOL_STOPS]);
/** Stops where the model deliberately declined; nothing to nudge, and nudging would push back. */
const REFUSALS = new Set(["refusal", "content_filter"]);

/** How much of each recovery path this run has already spent. Each has its own ceiling. */
interface RecoveryState {
    continues: number;
    lostCalls: number;
    idleNudges: number;
}

/**
 * What the turn that just ended asks of the loop. Everything it can ask used to be decided inline
 * in the loop, which put a truncation, a lost call and the ordinary end of a turn in the same three
 * lines of control flow. The rule lives in one place now:
 *
 * - Cut off with a call in hand: work in hand — the call runs and the run carries on.
 * - Cut off with nothing at all: ask for the rest, up to `MAX_TRUNCATION_CONTINUES` times. The
 *   output limit is not the model's answer, it is where its answer was cut, and nothing it produced
 *   so far is kept as work.
 * - A stop that claimed a call and delivered none: ask for the call again, up to
 *   `MAX_LOST_CALL_NUDGES` times. A dropped payload is not an answer.
 * - A turn that only narrated its next action: ask it to act, up to `MAX_IDLE_NUDGES` times.
 * - Anything else (a plain `end_turn`, a turn that called a tool): stop. An empty reply is the
 *   panel's to report, not a limit to announce.
 */
type EndingAction = { kind: "continue" | "lost-call" | "idle" | "stop"; notice?: I18nKeys };

function endingOf(turn: TurnParts, state: RecoveryState): EndingAction {
    const stop = turn.stopReason;
    if (stop !== undefined && TRUNCATED.has(stop)) {
        // A call the turn did carry is work in hand — the loop runs it and carries on, so the
        // cut cost the run nothing and there is nothing to announce.
        if (turn.toolCalls.length > 0) return { kind: "stop" };
        return state.continues < MAX_TRUNCATION_CONTINUES
            ? { kind: "continue" }
            : { kind: "stop", notice: "ai.truncated" };
    }

    if (turn.toolCalls.length === 0 && stop !== undefined && TOOL_STOPS.has(stop)) {
        return state.lostCalls < MAX_LOST_CALL_NUDGES
            ? { kind: "lost-call" }
            : { kind: "stop", notice: "ai.lostToolCall" };
    }

    if (turn.toolCalls.length === 0 && !REFUSALS.has(stop ?? "") && promisedToAct(turn.text)) {
        if (state.idleNudges < MAX_IDLE_NUDGES) return { kind: "idle" };
    }

    return { kind: "stop" };
}

/** Phrases that announce an action the model is about to take (not a closing). */
const INTENT_PATTERNS = [
    /\b(let me|let['’]s|i['’]ll|i will|i['’]m going to|now i['’]ll|next i['’]ll)\b/i,
    /(我来|让我|我先|接下来|然后|接着|现在我|我将|我要|马上)/,
    /\b(vou|vamos|irei|farei|criarei|começarei)\b/i,
];

/** Verbs that name something the model can actually do to the document. */
const ACTION_PATTERNS = [
    /\b(build|create|make|add|draw|model|construct|modify|edit|apply|run|insert|place|move|rotate|scale|extrude|revolve|fillet|chamfer|cut|subtract|fuse|combine|generate|sketch|start|begin)\b/i,
    /(创建|建|画|做|拉伸|旋转|切割|切|加|修改|移动|放|生成|建模|开始|执行)/,
    /\b(criar|crie|fazer|faço|adicionar|desenhar|modelar|construir|mover|rotacionar|escalar|extrudar|revolucionar|arredondar|chanfrar|cortar|gerar|começar)\b/i,
];

/** Forward-looking words that make a colon-ending a lead-in rather than a finished answer. */
const PLAN_PATTERNS = [/\b(plan|steps?|approach)\b/i, /(计划|步骤|方案|下一步)/, /\b(plano|etapas?)\b/i];

function announcesAction(text: string): boolean {
    return INTENT_PATTERNS.some((p) => p.test(text)) && ACTION_PATTERNS.some((p) => p.test(text));
}

/**
 * Whether the turn's last sentence promises an action it did not take. The check is deliberately
 * conservative and anchored to the end of the text: an earlier version matched anywhere in the
 * reply, fired on complete answers, and the nudge then read as user approval ("fabricated-consent
 * failure"). A question and "let me know" are never promises, and neither is a closing that names
 * no action.
 */
export function promisedToAct(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/[?？]\s*$/.test(trimmed)) return false;
    // The last sentence, without its terminator: "Let me build that." still promises. CJK
    // terminators are sentence boundaries too, or a Chinese reply stays one long "sentence".
    const tail = trimmed
        .split(/[.!?\n。！？；]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop();
    if (!tail) return false;
    if (/\blet me know\b/i.test(tail)) return false;
    // Waiting or negating is not a promise: "I'll wait for your confirmation", "I will not delete
    // that", "我先等你确认" all match an intent verb, and nudging them reads as consent the user
    // never gave — the failure this whole check exists to avoid. Non-English terms are matched
    // without word boundaries because CJK has none; each set is deliberately narrow.
    const waiting =
        /\b(wait|waiting|not|won['’]t|unless|confirm|confirmation|approve|approval)\b/i.test(tail) ||
        /(等待|等我|等你|等您|稍等|确认|除非|不会|不要)/.test(tail) ||
        /\b(aguardo|aguardando|espero|esperando|confirme|confirmação|não)\b/i.test(tail);
    if (waiting) return false;
    // A colon is only a lead-in when the text still says who will do what: "Here is the plan:"
    // qualifies; "Here is what I changed:" and "The remaining options are:" do not. The intent
    // and action may sit on different lines of a plan list, so this check reads the whole text.
    if (/[:：]\s*$/.test(trimmed)) {
        return announcesAction(trimmed) || PLAN_PATTERNS.some((pattern) => pattern.test(trimmed));
    }
    return announcesAction(tail);
}

/** The provider error's text, whether the SDK put it at the top or under `.error`. */
function errorMessage(err: unknown): string {
    if (!err || typeof err !== "object") return "";
    const e = err as { message?: unknown; error?: unknown };
    const nested = (e.error ?? {}) as { message?: unknown };
    return [
        typeof e.message === "string" ? e.message : "",
        typeof nested.message === "string" ? nested.message : "",
    ]
        .filter(Boolean)
        .join(" ");
}

/**
 * Whether a provider error is the endpoint refusing an oversized request. The message is what
 * separates this from every other 400: a bare status check would treat a malformed parameter as a
 * reason to shrink the history and send the same bad request again.
 */
export function isContextOverflowError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as { code?: unknown; status?: unknown; error?: unknown };
    const nested = (e.error ?? {}) as { code?: unknown; status?: unknown };
    if ((e.code ?? nested.code) === "context_length_exceeded") return true;
    const status = e.status ?? nested.status;
    if (status !== 400 && status !== 413) return false;
    return /context[_ -]?length|prompt is too long|too many tokens|maximum context|input is too long|request too large/i.test(
        errorMessage(err),
    );
}

/**
 * The real context window named by an overflow error, when it names one. The configured window is
 * a fallback, not the truth: a 1M default facing a 200K endpoint would size the compaction at
 * 500K and leave the history untouched. Both common wordings are read:
 *   Anthropic: "prompt is too long: 210000 tokens > 200000 maximum"
 *   OpenAI:    "This model's maximum context length is 128000 tokens. However, you requested 210000 tokens"
 */
export function contextLimitFromError(err: unknown): number | undefined {
    const message = errorMessage(err);
    if (!message) return undefined;
    const number = (raw: string | undefined) => {
        const value = Number(raw?.replace(/,/g, ""));
        return Number.isFinite(value) && value > 0 ? value : undefined;
    };

    const over = /(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)\s*(?:maximum|max|limit)/i.exec(message);
    if (over) return number(over[2]);
    const maximum = /maximum context length is\s*(\d[\d,]*)/i.exec(message);
    if (maximum) return number(maximum[1]);
    const only = /context length of only\s*(\d[\d,]*)\s*tokens/i.exec(message);
    if (only) return number(only[1]);
    const window = /context window (?:is|of)\s*(\d[\d,]*)/i.exec(message);
    if (window) return number(window[1]);
    return undefined;
}

function assistantMessage(text: string, toolCalls: ToolCall[], thinking: ThinkingBlock[]): ChatMessage {
    return {
        role: "assistant",
        content: text,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        thinking: thinking.length ? thinking : undefined,
    };
}

function appendToolResults(opts: RunAgentOptions, results: ToolOutput[]): void {
    opts.messages.push(
        ...results.map((r) => ({
            role: "tool" as const,
            toolCallId: r.toolCallId,
            name: r.name,
            content: r.content,
            images: r.images,
        })),
    );
    dropSupersededImages(opts.messages);
}

export { dropSupersededThinking } from "./messages";

/** Fold one stream event into the turn, forwarding text deltas to the UI as they arrive. */
function collectEvent(parts: TurnParts, ev: StreamEvent, callbacks: ChatCallbacks): void {
    if (ev.type === "text") {
        parts.text += ev.text;
        callbacks.onTextDelta(ev.text);
    } else if (ev.type === "tool_call") {
        parts.toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
    } else if (ev.type === "thinking") {
        parts.thinking.push(ev.block);
    } else if (ev.type === "thinking_delta") {
        // Display only: the block that carries it is what `parts.thinking` keeps for the replay.
        callbacks.onThinkingDelta(ev.text);
    } else if (ev.type === "done") {
        parts.stopReason = ev.stopReason;
    }
}

/**
 * One line per model turn: the cache counters are the only way to tell whether the stable
 * prompt prefix is being reused (cacheRead > 0 after the first turn) or silently invalidated —
 * and the stop reason with the elapsed time is what says whether a turn that ran long was cut
 * off, answered, or called a tool.
 *
 * A turn that ended short is printed at a level the console shows by default (the rest is
 * `debug`, which Chrome filters out as verbose): it is the explanation for a reply the user is
 * not getting, and looking for it should not require knowing to turn a level on.
 */
function logTokenUsage(
    usage: TokenUsage | undefined,
    stopReason: string | undefined,
    elapsedMs: number,
): void {
    const counters = usage
        ? `input=${usage.inputTokens} cacheRead=${usage.cacheReadTokens} ` +
          `cacheWrite=${usage.cacheCreationTokens} output=${usage.outputTokens} `
        : "usage=none ";
    const line = `[ai] tokens: ${counters}stop=${stopReason ?? "?"} ${Math.round(elapsedMs / 1000)}s`;
    if (stopReason !== undefined && SHORT_STOPS.has(stopReason)) console.warn(line);
    else console.debug(line);
}

/** Streams one model turn, forwarding text deltas to the UI and collecting tool calls. */
async function streamTurn(provider: LLMProvider, opts: RunAgentOptions): Promise<TurnParts> {
    const parts: TurnParts = { text: "", toolCalls: [], thinking: [] };
    let usage: TokenUsage | undefined;
    const startedAt = Date.now();
    for await (const ev of provider.streamChat({
        model: opts.config.model,
        effort: opts.config.reasoningEffort,
        system: opts.system,
        messages: opts.messages,
        tools: opts.tools,
        signal: opts.signal,
    })) {
        if (ev.type === "usage") usage = ev.usage;
        else collectEvent(parts, ev, opts.callbacks);
    }
    logTokenUsage(usage, parts.stopReason, Date.now() - startedAt);
    if (usage) opts.callbacks.onUsage(usage);
    return parts;
}

// Runs tool calls sequentially: ref-chained ops (run_box -> run_fillet) depend on
// earlier results being registered in the session, so parallel execution breaks them.
async function runToolCalls(opts: RunAgentOptions, toolCalls: ToolCall[]): Promise<ToolOutput[]> {
    opts.callbacks.onToolBatchStart?.();
    const results: ToolOutput[] = [];
    for (const tc of toolCalls) {
        // Stop between calls: a Stop or a conversation switch during the first call must not let
        // the second one run geometry the user already cancelled.
        if (opts.signal?.aborted) break;
        const tool = opts.tools.find((t) => t.name === tc.name);
        const { content, images } = await invokeTool(tc, tool, opts.signal);
        opts.callbacks.onToolCall({ name: tc.name, arguments: tc.arguments, result: content });
        results.push({ toolCallId: tc.id, name: tc.name, content, images });
    }
    return results;
}

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
 * are made, so the transcript's card and the saved chat carry the same summary as the request.
 */
export function redactDataUrls(content: string): string {
    return content.replace(
        /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{512,})/g,
        (_match, mediaType: string, data: string) =>
            `data:${mediaType};base64,<${Math.max(1, Math.round((data.length * 3) / 4 / 1024))} KB omitted — the image is in the document, not in the result>`,
    );
}

/** Executes a single tool call; unknown tools and thrown errors become JSON the model can read. */
async function invokeTool(
    tc: ToolCall,
    tool: Tool | undefined,
    signal?: AbortSignal,
): Promise<{ content: string; images?: ImagePart[] }> {
    if (!tool) {
        return { content: JSON.stringify({ error: `unknown tool "${tc.name}"` }) };
    }
    try {
        const result = await tool.handler(JSON.parse(tc.arguments), signal);
        if (typeof result === "string") {
            return { content: redactDataUrls(result) };
        }
        return { content: redactDataUrls(result.content), images: result.images };
    } catch (err) {
        // A thrown message can quote the rejected value in full (coercion errors do), so it is
        // held to the same rule as a result: image bytes stay out of the replayed history.
        return { content: JSON.stringify({ error: redactDataUrls((err as Error).message) }) };
    }
}
