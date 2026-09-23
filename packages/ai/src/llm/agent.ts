// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys } from "@chili3d/core";
import type { LLMConfig } from "../settings";
import { AnthropicProvider } from "./anthropic";
import { CompletionsProvider } from "./completions";
import { ResponsesProvider } from "./responses";
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
 * Addressed to the model, not to the user, so it stays out of i18n — the same rule as
 * ASK_INTERRUPTED. The second sentence is the one that matters for a model that plans its whole
 * task in one head: it is asked to act, because that is what the next request has room for.
 */
const CONTINUE_AFTER_TRUNCATION =
    "Your last message was cut off by the output limit before it produced an answer or a tool call. " +
    "Continue from where it stopped, without repeating what you already said. If you have not " +
    "started the work yet, make a tool call now rather than planning further.";

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
}

type ToolOutput = { toolCallId: string; name: string; content: string; images?: ImagePart[] };

export function createProvider(config: LLMConfig): LLMProvider {
    if (config.provider === "anthropic") return new AnthropicProvider(config);
    if (config.provider === "responses") return new ResponsesProvider(config);
    return new CompletionsProvider(config);
}

export async function runAgent(opts: RunAgentOptions): Promise<void> {
    const provider = opts.provider ?? createProvider(opts.config);
    // A new user turn is under way: what the last one thought is no longer replayed (see
    // dropSupersededThinking), so every request below is spared it.
    dropSupersededThinking(opts.messages);

    let continues = 0;

    try {
        for (let iteration = 0; ; iteration++) {
            if (opts.signal?.aborted) break;
            const turn = await streamTurn(provider, opts);

            opts.messages.push(assistantMessage(turn.text, turn.toolCalls, turn.thinking));
            const ending = endingOf(turn, continues);
            if (ending.notice !== undefined) opts.callbacks.onTextDelta(I18n.translate(ending.notice));
            if (ending.askForTheRest) {
                continues++;
                opts.messages.push({ role: "user", content: CONTINUE_AFTER_TRUNCATION });
                continue;
            }
            if (turn.toolCalls.length === 0) break;

            appendToolResults(opts, await runToolCalls(opts, turn.toolCalls));

            if (opts.signal?.aborted) break;
            if (iteration + 1 >= MAX_AGENT_ITERATIONS) {
                // Always say so: the run stops wherever the plan happened to be, and this message
                // is the only thing telling the user it was a limit rather than a finished answer.
                opts.callbacks.onTextDelta(I18n.translate("ai.stepLimit"));
                break;
            }
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

/**
 * What the turn that just ended asks of the loop. Everything it can ask used to be decided inline
 * in the loop, which put a truncation, a lost call and the ordinary end of a turn in the same three
 * lines of control flow. The rule lives in one place now:
 *
 * - Cut off with a call in hand: work in hand — the call runs and the run carries on.
 * - Cut off with nothing at all: ask for the rest, up to `MAX_TRUNCATION_CONTINUES` times. The
 *   output limit is not the model's answer, it is where its answer was cut, and nothing it produced
 *   so far is kept as work.
 * - Out of continuations, or a stop that claimed a call and delivered none: stop, and leave the
 *   notice that says which it was — the alternative is a turn that stops with nothing on screen
 *   explaining why.
 * - Anything else (a plain `end_turn`, a turn that called a tool): nothing to say here. An empty
 *   reply is the panel's to report, not a limit to announce.
 */
function endingOf(turn: TurnParts, continues: number): { askForTheRest?: boolean; notice?: I18nKeys } {
    if (turn.stopReason === undefined) return {};
    if (TRUNCATED.has(turn.stopReason)) {
        const worthAsking = turn.toolCalls.length === 0 && continues < MAX_TRUNCATION_CONTINUES;
        return worthAsking ? { askForTheRest: true } : { notice: "ai.truncated" };
    }
    const claimed = turn.toolCalls.length === 0 && TOOL_STOPS.has(turn.stopReason);
    return claimed ? { notice: "ai.lostToolCall" } : {};
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

/**
 * Every screenshot answers "what does it look like now", which makes each older one dead weight —
 * and at a few MB of base64 apiece the largest thing in the history resent on every iteration. So
 * only the newest screenshot is replayed. Images the user attached are left alone: those are input
 * the turn was asked about, not a picture of a moment that has passed. The panel's `trimMessages`
 * drops the screenshots altogether when a turn begins.
 */
function dropSupersededImages(messages: ChatMessage[]): void {
    let newestShot = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        // bound to a local: narrowing does not survive an indexed access through a `let` index
        const message = messages[i];
        if (message.role === "tool" && message.images?.length) {
            newestShot = i;
            break;
        }
    }
    for (const [i, m] of messages.entries()) {
        if (m.role === "tool" && i !== newestShot) m.images = undefined;
    }
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
        if (messages[i].role === "user") {
            boundary = i;
            break;
        }
    }
    for (const [i, message] of messages.entries()) {
        if (i < boundary && message.role === "assistant") message.thinking = undefined;
    }
}

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
    const results: ToolOutput[] = [];
    for (const tc of toolCalls) {
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
        return { content: JSON.stringify({ error: (err as Error).message }) };
    }
}
