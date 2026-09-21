// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CAMERA_FLY_DURATION,
    I18n,
    type I18nKeys,
    type IDocument,
    type IHistoryRecord,
    type INode,
    type IView,
    Localize,
    PubSub,
} from "@chili3d/core";
import {
    button,
    div,
    form,
    img,
    input,
    option,
    select,
    setSVGIcon,
    span,
    svg,
    textarea,
} from "@chili3d/element";
import { marked, type Tokens } from "marked";
import style from "./chatPanel.module.css";
import {
    conversationTitle,
    messageParts,
    newConversation,
    readConversations,
    type StoredAsk,
    type StoredConversation,
    type StoredMessage,
    type StoredPart,
    type StoredToolCall,
    writeConversations,
} from "./history";
import { runAgent } from "./llm/agent";
import { buildSystemPrompt } from "./llm/prompt";
import type { ChatMessage, ImagePart, TokenUsage } from "./llm/types";
import {
    CONTEXT_WINDOW_OPTIONS,
    currentConfig,
    DEFAULT_CONTEXT_WINDOW,
    type LLMConfig,
    loadConfig,
    offerKeyToPasswordManager,
    PROVIDER_PRESETS,
    type ProviderPreset,
    saveConfig,
} from "./settings";
import { buildTools } from "./tools";
import { type AskRequest, setAskHandler } from "./tools/askUser";
import { findNode, getDocument } from "./tools/documentContext";

/**
 * How much of the model's window the resent history may fill before the oldest turns are dropped.
 * The remainder is slack for the estimate below, which is deliberately rough.
 */
const CONTEXT_BUDGET_RATIO = 0.8;

/**
 * How close to the bottom still counts as reading along. About a line: far enough that rounding
 * or a footer landing does not break the follow, near enough that a deliberate scroll away does.
 */
const FOLLOW_BOTTOM_SLACK = 32;

/**
 * Tool result handed back when a question is abandoned rather than answered. Protocol text, like
 * the error strings in tools/documentContext.ts — not UI copy, so it stays out of i18n.
 */
const ASK_INTERRUPTED =
    "The user interrupted without answering — do not repeat the question; wait for their next message.";

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

marked.use({
    gfm: true,
    breaks: true,
    renderer: {
        // The model's output is untrusted: render raw HTML as text instead of injecting it.
        html({ text }: Tokens.HTML | Tokens.Tag) {
            return escapeHtml(text);
        },
    },
});

function renderMarkdown(raw: string): string {
    return marked.parse(raw, { async: false });
}

/** The parts of a tool result a chat card summarizes; anything else falls back to the raw text. */
interface ToolResultSummary {
    ref?: string;
    created?: { nodeId?: string; name?: string }[];
    removed?: { nodeId?: string; name?: string }[];
    error?: string;
}

/** One line of a tool card's detail. `nodeIds` marks what clicking it should reveal. */
interface ResultSegment {
    text: string;
    nodeIds?: string[];
}

function summarizeResult(parsed: ToolResultSummary, fallback: string): ResultSegment[] {
    const names = (nodes: { nodeId?: string; name?: string }[]) =>
        nodes
            .map((n) => n.name ?? n.nodeId ?? "")
            .filter(Boolean)
            .join(", ");

    const ids = (nodes: { nodeId?: string }[]) =>
        nodes.map((n) => n.nodeId).filter((id): id is string => id !== undefined);

    const segments: ResultSegment[] = [];
    if (parsed.created?.length) {
        // Created nodes still exist, so the segment can point at them. Removed ones cannot —
        // they are gone the moment the call returns, and a dead link is worse than none.
        segments.push({
            text: I18n.translate("ai.tool.created", names(parsed.created)),
            nodeIds: ids(parsed.created),
        });
    }
    if (parsed.removed?.length) {
        segments.push({ text: I18n.translate("ai.tool.removed", names(parsed.removed)) });
    }
    if (segments.length) return segments;
    return [{ text: parsed.ref ? I18n.translate("ai.tool.created", parsed.ref) : fallback }];
}

/** Mutable state of the assistant output streaming in during one turn. */
interface StreamState {
    /** The paragraph being streamed right now; null between a tool call and the text after it. */
    block: HTMLElement | null;
    /** That paragraph's own text, reset each time a tool call or question closes it. */
    blockText: string;
    /** The reasoning block streaming right now, until text or a tool call closes it. */
    thinking: HTMLElement | null;
    thinkingText: string;
    /** When that reasoning block opened, for the "thought for Ns" summary. */
    thinkingStartedAt: number;
    /** The whole turn's text, across every paragraph — what the copy button and the record hold. */
    raw: string;
}

/** What one finished turn leaves for the transcript, once its bubble has stopped streaming. */
interface SettledTurn {
    /** The turn's parts in order — empty when there is no bubble left to have owned them. */
    parts: StoredPart[];
    /** Those parts' text read back, which is what the copy button and the record's `text` carry. */
    text: string;
    /** Wall-clock milliseconds the turn spent in tool calls, or undefined if it called none. */
    workedMs?: number;
}

/**
 * A user turn the transcript can take back: the row that stands for it, what it carried, and where
 * the document's undo stack stood when it began (`mark` undefined means an empty stack, which is
 * still somewhere to rewind to — the turn's own records are then all there is to undo).
 */
interface RevertedTurn {
    mark: IHistoryRecord | undefined;
    text: string;
    images?: ImagePart[];
    el: HTMLElement;
}

/**
 * How full the model's context is after a request. Every input token counts — cached or not, it
 * is sitting in the window — while output is the reply, which only joins the context next turn.
 */
function contextTokens(usage: TokenUsage): number {
    return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

/** The estimated weight of a conversation — what the trim budget and the meter both need. */
function estimateContext(messages: ChatMessage[]): number {
    return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

/**
 * Roughly what a message costs the context. There is no tokenizer in the browser, so this is the
 * usual four-characters-per-token rule of thumb, applied to everything that goes over the wire:
 * text, tool arguments, reasoning (which is replayed), and base64 images. It only has to pick a
 * trim point with room to spare — the exact count arrives with every response.
 */
function estimateTokens(message: ChatMessage): number {
    let chars = message.content.length;
    if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) chars += call.name.length + call.arguments.length;
        for (const block of message.thinking ?? []) {
            chars +=
                block.type === "thinking"
                    ? block.thinking.length + block.signature.length
                    : block.data.length;
        }
    } else {
        for (const image of message.images ?? []) chars += image.data.length;
    }
    return Math.ceil(chars / 4);
}

/** `1000` and `1_000_000` must not read as `1.0k` and `1000.0k`. */
function formatTokens(count: number): string {
    const scaled = (value: number, unit: string) =>
        `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
    if (count >= 1_000_000) return scaled(count / 1_000_000, "M");
    if (count >= 1000) return scaled(count / 1000, "k");
    return `${count}`;
}

export class ChatPanel extends HTMLElement {
    readonly header: HTMLElement;
    onClose?: () => void;
    onDock?: () => void;

    private readonly messages: ChatMessage[] = [];
    private readonly messageList: HTMLElement;
    private readonly emptyState: HTMLElement;
    private readonly composer: HTMLElement;
    /** The composer's input card, hidden while a question stands in for it. */
    private composerCard!: HTMLElement;
    private readonly input: HTMLTextAreaElement;
    private readonly sendButton: HTMLButtonElement;
    private titleEl!: HTMLElement;
    private closeButtonEl!: HTMLButtonElement;
    private dockButtonEl!: HTMLButtonElement;
    private settingsButtonEl!: HTMLButtonElement;
    private historyButtonEl!: HTMLButtonElement;
    private newChatButtonEl!: HTMLButtonElement;
    private headerButtons!: HTMLElement;
    private settingsOverlay?: HTMLElement;
    private historyOverlay?: HTMLElement;
    private historyListEl?: HTMLElement;
    /** The document whose history is on screen, and whose `userData` holds it. */
    private document?: IDocument;
    /** The active document's archived conversations; the in-flight one is `conversation`. */
    private conversations: StoredConversation[] = [];
    private conversation: StoredConversation = newConversation();
    /** The turn in flight, in the order it happened, projected onto its message when it ends. */
    private turnParts: StoredPart[] = [];
    /** When the turn in flight started, for the "worked for Ns" summary. */
    private turnStartedAt = 0;
    /**
     * What the model's window currently holds. A response reports it exactly, and that figure
     * stands until something changes the history underneath it — so a revert recomputes it from
     * the messages that survived. That recomputation is an estimate; every other value here is
     * measured, which is why this is a plain count and not a `TokenUsage`.
     */
    private contextUsed?: number;
    private contextMeter!: HTMLElement;
    private contextFill!: HTMLElement;
    private contextText!: HTMLElement;
    /**
     * What was on top of the document's undo stack when the turn began — how far a turn rewinds
     * it. The record itself, not a depth: `undoLimits` pins `undoCount` once the stack is full,
     * so a count would stop describing the stack exactly when there is most to rewind.
     */
    private turnHistoryMark?: IHistoryRecord;
    /** The fullest reading of the window this turn reported, to be kept with its message. */
    private turnUsage?: TokenUsage;
    /** The "the model no longer sees all of this" marker, once the context has overflowed. */
    private contextNoticeEl?: HTMLElement;
    /**
     * The assistant bubble of the turn in flight. Every part of the turn — paragraphs, tool
     * cards, question cards — lands inside it in the order it streamed, so the turn reads the
     * way it happened.
     */
    private activeAssistantEl?: HTMLElement;
    /** The waiting indicator, up until the turn produces its first visible part. */
    private thinkingEl?: HTMLElement;
    private stream?: StreamState;
    /** Settles the question card currently waiting on the user, if one is up. */
    private settleAsk?: (answer: string, recorded?: string) => void;
    /**
     * The conversation the turn in flight belongs to. `endTurn` compares it against the current
     * one so a run that outlives a switch — aborted late, still unwinding — cannot write its
     * tail into whatever conversation opened next.
     */
    private turnConversation?: StoredConversation;
    private providerSelect!: HTMLSelectElement;
    private baseURLInput!: HTMLInputElement;
    private modelInput!: HTMLInputElement;
    private contextWindowSelect!: HTMLSelectElement;
    /**
     * The preset the model and base URL fields were last set from — what a provider switch compares
     * them against to tell the preset's own values from the user's (see `onProviderChanged`).
     */
    private appliedPreset?: ProviderPreset;
    /** Holds a window size outside the common tiers, so an older custom value stays visible. */
    private customWindowOption?: HTMLOptionElement;
    private apiKeyInput!: HTMLInputElement;
    private usernameInput!: HTMLInputElement;
    private readonly imagePreview: HTMLElement;
    private readonly pendingImages: ImagePart[] = [];
    private configured = false;
    private sending = false;
    private abortController?: AbortController;
    /** The send arrow, swapped for the stop square while a run is in flight. */
    private sendIconEl!: SVGSVGElement;

    constructor() {
        super();
        this.className = style.root;

        this.messageList = div({ className: style.messageList });
        this.input = this.createInput();
        this.sendButton = this.createSendButton();
        this.header = this.createHeader();
        this.imagePreview = div({ className: style.imagePreview });

        const fileInput = this.createFileInput();
        this.composer = this.createComposer(fileInput);
        this.emptyState = this.createEmptyState();

        this.append(
            this.header,
            this.messageList,
            this.emptyState,
            this.imagePreview,
            this.composer,
            fileInput,
            this.buildSettingsOverlay(),
            this.buildHistoryOverlay(),
        );
        this.loadConfig();
        this.openDocument(getDocument());
        // The ask_user tool reaches its card through here; see tools/askUser.ts for the channel.
        setAskHandler((request, signal) => this.askUser(request, signal));
        // Subscribed once, for the panel's whole life: floating mode detaches by moving this node
        // between parents, so a connect/disconnect pair would re-subscribe on every drag.
        PubSub.default.sub("activeViewChanged", this.onActiveViewChanged);
    }

    private createInput(): HTMLTextAreaElement {
        return textarea({
            className: style.input,
            placeholder: I18n.translate("ai.inputPlaceholder"),
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
                    e.preventDefault();
                    this.send();
                }
            },
            oninput: () => this.autosizeInput(),
            onpaste: (e: ClipboardEvent) => this.handlePaste(e),
        });
    }

    private handlePaste(e: ClipboardEvent) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) this.addImage(file);
            }
        }
    }

    private createSendButton(): HTMLButtonElement {
        this.sendIconEl = svg({ className: style.sendIcon, icon: "icon-up" });
        return button(
            {
                className: style.sendButton,
                title: I18n.translate("ai.sendHint"),
                onclick: () => (this.sending ? this.interrupt() : this.send()),
            },
            this.sendIconEl,
        );
    }

    private createHeader(): HTMLElement {
        return div({ className: style.header }, this.createTitle(), this.createHeaderButtons());
    }

    private createTitle(): HTMLElement {
        this.titleEl = div(
            { className: style.title },
            svg({ className: style.titleIcon, icon: "icon-chili" }),
            span({ textContent: new Localize("ai.title") }),
        );
        return this.titleEl;
    }

    /** One header icon button; `title` is the tooltip key, omitted by the dock button. */
    private headerButton(
        icon: string,
        title: I18nKeys | undefined,
        onclick: () => void,
        hidden = false,
    ): HTMLButtonElement {
        return button(
            {
                className: style.iconButton,
                ...(title === undefined ? {} : { title: I18n.translate(title) }),
                ...(hidden ? { style: "display: none" } : {}),
                onclick,
            },
            svg({ className: style.buttonIcon, icon }),
        );
    }

    private createHeaderButtons(): HTMLElement {
        this.closeButtonEl = this.headerButton("icon-times", "ai.cancel", () => this.onClose?.());
        this.dockButtonEl = this.headerButton("icon-compress-alt", undefined, () => this.onDock?.(), true);
        this.settingsButtonEl = this.headerButton("icon-cog", "ai.settings", () => this.showSettings());
        this.historyButtonEl = this.headerButton("icon-history", "ai.history", () => this.showHistory());
        this.newChatButtonEl = this.headerButton("icon-plus", "ai.newChat", () =>
            this.startNewConversation(),
        );

        this.headerButtons = div(
            { className: style.headerButtons },
            this.settingsButtonEl,
            this.historyButtonEl,
            this.newChatButtonEl,
            this.dockButtonEl,
            this.closeButtonEl,
        );
        return this.headerButtons;
    }

    private createFileInput(): HTMLInputElement {
        return input({
            type: "file",
            accept: "image/*",
            multiple: true,
            style: "display: none",
            onchange: (e: Event) => {
                const target = e.target as HTMLInputElement;
                const files = target.files;
                if (files) {
                    for (const file of Array.from(files)) this.addImage(file);
                }
                target.value = "";
            },
        });
    }

    private createComposer(fileInput: HTMLInputElement): HTMLElement {
        const attachButton = button(
            {
                className: style.attachButton,
                onclick: () => fileInput.click(),
            },
            svg({ className: style.attachIcon, icon: "icon-plus" }),
        );
        this.composerCard = div(
            { className: style.composerCard },
            this.input,
            div({ className: style.composerBar }, attachButton, this.createContextMeter(), this.sendButton),
        );
        return div({ className: style.composer }, this.composerCard);
    }

    /**
     * How full the model's context is, sitting in the send row because that is the one strip of
     * the panel always in view. Hidden until a request reports usage: a bar at zero says nothing.
     */
    private createContextMeter(): HTMLElement {
        this.contextFill = div({ className: style.contextFill });
        this.contextText = span({ className: style.contextText });
        this.contextMeter = div(
            { className: style.contextMeter, style: "display: none" },
            div({ className: style.contextBar }, this.contextFill),
            this.contextText,
        );
        return this.contextMeter;
    }

    private renderContextMeter() {
        const used = this.contextUsed;
        if (used === undefined) {
            this.contextMeter.style.display = "none";
            return;
        }
        const window = currentConfig().contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        const ratio = window > 0 ? Math.min(1, used / window) : 1;
        this.contextMeter.style.display = "";
        this.contextMeter.title = I18n.translate("ai.contextHint", formatTokens(used), formatTokens(window));
        this.contextMeter.classList.toggle(style.contextMeterFull, ratio >= 0.8);
        this.contextFill.style.width = `${(ratio * 100).toFixed(1)}%`;
        this.contextText.textContent = `${formatTokens(used)} / ${formatTokens(window)}`;
    }

    private createEmptyState(): HTMLElement {
        return div(
            { className: style.emptyState },
            svg({ className: style.emptyIcon, icon: "icon-chili" }),
            div({ className: style.emptyTitle, textContent: new Localize("ai.emptyTitle") }),
            div({ className: style.emptyHint, textContent: new Localize("ai.emptyHint") }),
            div({ className: style.emptyHint, textContent: new Localize("ai.emptyExample") }),
            div({ className: style.emptyAsk, textContent: new Localize("ai.emptyAsk") }),
        );
    }

    connectedCallback(): void {
        if (!this.configured) this.showSettings();
        this.autosizeInput();
    }

    setFloating(floating: boolean) {
        this.header.style.display = floating ? "none" : "";
        this.dockButtonEl.style.display = floating ? "" : "none";
        if (!floating) {
            this.headerButtons.append(
                this.settingsButtonEl,
                this.historyButtonEl,
                this.newChatButtonEl,
                this.dockButtonEl,
                this.closeButtonEl,
            );
        }
    }

    /** Buttons hosted by the FloatPanel title bar while floating. */
    floatingActions(): HTMLElement[] {
        return [this.settingsButtonEl, this.historyButtonEl, this.newChatButtonEl, this.dockButtonEl];
    }

    private loadConfig() {
        this.configured = !!loadConfig()?.apiKey;
        this.renderState();
    }

    private renderState() {
        this.composer.style.display = this.configured ? "" : "none";
        this.updateEmptyState();
    }

    private updateEmptyState() {
        const hasMessages = this.messages.length > 0;
        this.emptyState.style.display = this.configured && !hasMessages ? "flex" : "none";
        this.messageList.style.display = this.configured && hasMessages ? "flex" : "none";
    }

    private buildSettingsOverlay(): HTMLElement {
        this.createSettingsInputs();
        this.settingsOverlay = div(
            { className: style.settingsOverlay, style: "display: none" },
            this.createSettingsHeader(),
            this.createSettingsForm(),
        );
        return this.settingsOverlay;
    }

    private createSettingsInputs() {
        this.providerSelect = select(
            { className: style.field },
            ...PROVIDER_PRESETS.map((p) => option({ value: p.id, textContent: p.label })),
        );
        this.baseURLInput = input({ className: style.field, placeholder: "base URL (OpenAI-compatible)" });
        this.modelInput = input({ className: style.field, placeholder: "model" });
        this.contextWindowSelect = select(
            { className: style.field },
            ...CONTEXT_WINDOW_OPTIONS.map((size) =>
                option({ value: String(size), textContent: formatTokens(size) }),
            ),
        );
        // Login-form semantics let the OS/browser password manager keep the key; the
        // app itself only holds it in memory for the session (see settings.ts).
        this.usernameInput = input({
            type: "text",
            name: "username",
            autocomplete: "username",
            tabIndex: -1,
            style: "display: none",
        });
        this.apiKeyInput = input({
            className: style.field,
            placeholder: "API Key",
            type: "password",
            name: "password",
            autocomplete: "current-password",
        });

        this.providerSelect.onchange = () => this.onProviderChanged();
    }

    private settingsField(label: Localize, el: HTMLElement) {
        return div(
            { className: style.settingsField },
            div({ className: style.settingsLabel, textContent: label }),
            el,
        );
    }

    private createSettingsHeader(): HTMLElement {
        return div(
            { className: style.settingsHeader },
            this.headerButton("icon-back", "ai.cancel", () => this.hideSettings()),
            div({ className: style.settingsTitle, textContent: new Localize("ai.settingsTitle") }),
            // The overlay covers the panel's own header, so it has to carry that header's close
            // button — same icon, same tooltip, same action.
            this.headerButton("icon-times", "ai.cancel", () => this.onClose?.()),
        );
    }

    private createSettingsForm(): HTMLElement {
        return form(
            {
                style: "display: contents",
                onsubmit: (e: SubmitEvent) => {
                    e.preventDefault();
                    void this.saveSettings();
                },
            },
            div(
                { className: style.settingsBody },
                this.usernameInput,
                this.settingsField(new Localize("ai.provider"), this.providerSelect),
                this.settingsField(new Localize("ai.baseURL"), this.baseURLInput),
                this.settingsField(new Localize("ai.model"), this.modelInput),
                this.settingsField(new Localize("ai.contextWindow"), this.contextWindowSelect),
                this.settingsField(new Localize("ai.apiKey"), this.apiKeyInput),
                div({ className: style.settingsHint, textContent: new Localize("ai.apiKeyHint") }),
            ),
            this.settingsFooter(),
        );
    }

    private settingsFooter(): HTMLElement {
        return div(
            { className: style.settingsFooter },
            button({
                className: style.cancelButton,
                type: "button",
                textContent: new Localize("ai.cancel"),
                onclick: () => this.hideSettings(),
            }),
            button({
                className: style.saveButton,
                type: "submit",
                textContent: new Localize("ai.save"),
            }),
        );
    }

    /**
     * The provider select changed, so the preset can fill the fields the user has not made their
     * own — a field still holding what the last preset put there is the preset's to change, and
     * one holding anything else is theirs: the proxy address everything routes through, a model
     * name no preset has heard of. An empty one is nobody's either — it says nothing worth keeping,
     * and a switch is as good a moment as any to fill it. Switching provider is not a reset.
     */
    private onProviderChanged() {
        const preset = PROVIDER_PRESETS.find((p) => p.id === this.providerSelect?.value);
        if (!preset) return;
        const previous = this.appliedPreset;
        /** Whether the field is the preset's to write: empty, or still holding the last preset's. */
        const unclaimed = (current: string, from?: string) =>
            current === "" || previous === undefined || current === (from ?? "");
        if (unclaimed(this.baseURLInput.value, previous?.baseURL)) {
            this.baseURLInput.value = preset.baseURL ?? "";
        }
        if (unclaimed(this.modelInput.value, previous?.defaultModel)) {
            this.modelInput.value = preset.defaultModel;
        }
        this.appliedPreset = preset;
        if (this.usernameInput) this.usernameInput.value = preset.id;
    }

    /** Nothing saved to start from, so the preset's own values stand in — blank fields help nobody. */
    private applyPresetDefaults() {
        const preset = PROVIDER_PRESETS.find((p) => p.id === this.providerSelect?.value);
        if (!preset) return;
        this.baseURLInput.value = preset.baseURL ?? "";
        this.modelInput.value = preset.defaultModel;
        this.syncContextWindowValue(DEFAULT_CONTEXT_WINDOW);
        if (this.usernameInput) this.usernameInput.value = preset.id;
        this.appliedPreset = preset;
    }

    /**
     * Show `size` in the select, adding a one-off entry when it is not one of the common tiers —
     * a value typed in before this was a select, which the select would otherwise blank out and
     * then silently replace with the default on save.
     */
    private syncContextWindowValue(size: number) {
        const select = this.contextWindowSelect;
        if (CONTEXT_WINDOW_OPTIONS.includes(size)) {
            this.customWindowOption?.remove();
            this.customWindowOption = undefined;
        } else if (this.customWindowOption) {
            this.customWindowOption.value = String(size);
            this.customWindowOption.textContent = formatTokens(size);
        } else {
            this.customWindowOption = option({ value: String(size), textContent: formatTokens(size) });
            select.append(this.customWindowOption);
        }
        select.value = String(size);
    }

    private showSettings() {
        if (!this.settingsOverlay) return;
        const saved = loadConfig();
        if (saved && this.providerSelect && this.baseURLInput && this.modelInput && this.apiKeyInput) {
            const preset = PROVIDER_PRESETS.find((p) => p.provider === saved.provider);
            if (preset) this.providerSelect.value = preset.id;
            // Which preset the shown values came from, so a switch can still tell an untouched
            // field from one the user has made their own since.
            this.appliedPreset = preset;
            this.baseURLInput.value = saved.baseURL ?? "";
            this.modelInput.value = saved.model;
            this.syncContextWindowValue(saved.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
            this.apiKeyInput.value = saved.apiKey;
            if (this.usernameInput) this.usernameInput.value = preset?.id ?? saved.provider;
        } else {
            this.applyPresetDefaults();
        }
        this.settingsOverlay.style.display = "flex";
    }

    private hideSettings() {
        if (this.settingsOverlay) this.settingsOverlay.style.display = "none";
    }

    private async saveSettings() {
        const preset = PROVIDER_PRESETS.find((p) => p.id === this.providerSelect?.value);
        const config: LLMConfig = {
            provider: preset?.provider ?? "anthropic",
            baseURL: this.baseURLInput?.value || undefined,
            model: this.modelInput?.value ?? "",
            contextWindow: Number(this.contextWindowSelect?.value) || DEFAULT_CONTEXT_WINDOW,
            apiKey: this.apiKeyInput?.value.trim() ?? "",
        };
        saveConfig(config);
        await offerKeyToPasswordManager(preset?.id ?? config.provider, config.apiKey);
        this.configured = config.apiKey.length > 0;
        this.renderState();
        this.hideSettings();
    }

    private startNewConversation() {
        this.saveConversation();
        this.startConversation();
        this.hideHistory();
    }

    /**
     * Drop the transcript and begin a fresh, empty conversation. The one being left is already
     * archived by the caller, so nothing is lost — which is why this replaced a plain "clear".
     */
    private startConversation() {
        this.abandonPendingAsk();
        this.conversation = newConversation();
        this.messages.length = 0;
        this.turnParts = [];
        this.messageList.innerHTML = "";
        this.contextNoticeEl = undefined;
        this.contextUsed = undefined;
        this.renderContextMeter();
        this.pendingImages.length = 0;
        this.renderImagePreview();
        this.updateEmptyState();
    }

    /**
     * Release a question the user has navigated away from. Every path that replaces the transcript
     * goes through here — without it the run that asked would await forever and `sending` would
     * never come back down.
     */
    private abandonPendingAsk() {
        this.settleAsk?.(ASK_INTERRUPTED, I18n.translate("ai.ask.notAnswered"));
    }

    private buildHistoryOverlay(): HTMLElement {
        this.historyListEl = div({ className: style.historyList });
        this.historyOverlay = div(
            { className: style.historyOverlay, style: "display: none" },
            this.createHistoryHeader(),
            this.historyListEl,
        );
        return this.historyOverlay;
    }

    private createHistoryHeader(): HTMLElement {
        return div(
            { className: style.historyHeader },
            this.headerButton("icon-back", "ai.cancel", () => this.hideHistory()),
            div({ className: style.historyTitle, textContent: new Localize("ai.history") }),
            // Same reason as the settings overlay: it hides the panel header it borrows from.
            this.headerButton("icon-times", "ai.cancel", () => this.onClose?.()),
        );
    }

    private showHistory() {
        if (!this.historyOverlay) return;
        this.renderHistoryList();
        this.historyOverlay.style.display = "flex";
    }

    private hideHistory() {
        if (this.historyOverlay) this.historyOverlay.style.display = "none";
    }

    private renderHistoryList() {
        const list = this.historyListEl;
        if (!list) return;
        list.innerHTML = "";
        const items = this.sortedConversations();
        if (items.length === 0) {
            list.append(div({ className: style.historyEmpty, textContent: new Localize("ai.historyEmpty") }));
            return;
        }
        for (const conversation of items) list.append(this.historyItem(conversation));
    }

    private sortedConversations(): StoredConversation[] {
        return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private historyItem(conversation: StoredConversation): HTMLElement {
        const title = conversation.title || I18n.translate("ai.untitled");
        const active = conversation.id === this.conversation.id;
        return div(
            {
                className: active ? `${style.historyItem} ${style.historyItemActive}` : style.historyItem,
                onclick: () => this.openConversation(conversation),
            },
            div(
                { className: style.historyItemBody },
                span({ className: style.historyItemTitle, textContent: title }),
                span({
                    className: style.historyItemDate,
                    textContent: new Date(conversation.updatedAt).toLocaleDateString(),
                }),
            ),
            button(
                {
                    className: style.historyItemDelete,
                    title: I18n.translate("ai.historyDelete", title),
                    onclick: (e: MouseEvent) => {
                        e.stopPropagation();
                        this.deleteConversation(conversation);
                    },
                },
                svg({ className: style.historyItemDeleteIcon, icon: "icon-times" }),
            ),
        );
    }

    private deleteConversation(conversation: StoredConversation) {
        const title = conversation.title || I18n.translate("ai.untitled");
        if (!window.confirm(I18n.translate("ai.historyDelete", title))) return;
        this.conversations = this.conversations.filter((c) => c.id !== conversation.id);
        if (conversation.id === this.conversation.id) this.startConversation();
        this.saveConversation();
        this.renderHistoryList();
    }

    /** Restore an archived conversation: the transcript, and the context the model resumes from. */
    private openConversation(conversation: StoredConversation) {
        this.abandonPendingAsk();
        this.conversation = conversation;
        this.messages.length = 0;
        this.messages.push(...conversation.messages.map(toChatMessage));
        this.trimMessages();
        this.renderConversation(conversation);
        this.hideHistory();
    }

    /** Rebuild the whole transcript from stored messages, as if it had just streamed in. */
    private renderConversation(conversation: StoredConversation) {
        this.messageList.innerHTML = "";
        this.contextNoticeEl = undefined;
        for (const message of conversation.messages) {
            if (message.role === "user") {
                this.appendBubble("user", message.text, message.images);
                continue;
            }
            const el = div({ className: style.assistant });
            this.messageList.append(el);
            for (const part of messageParts(message)) {
                if (part.type === "text") {
                    el.append(div({ className: style.markdown, innerHTML: renderMarkdown(part.text) }));
                } else if (part.type === "tool") {
                    el.append(this.toolCardElement(part));
                } else if (part.type === "thinking") {
                    el.append(this.thinkingPartElement(part));
                } else {
                    el.append(this.askCardElement(part));
                }
            }
            el.append(this.messageFooter(message.text, message.time, message.workedMs));
        }
        // Reopening a conversation resumes its context, so the meter reads what the model holds
        // rather than starting blank.
        const saved = [...conversation.messages].reverse().find((m) => m.usage)?.usage;
        this.contextUsed = saved ? contextTokens(saved) : undefined;
        this.renderContextMeter();
        this.updateEmptyState();
        this.scrollToBottom();
    }

    private readonly onActiveViewChanged = (view: IView | undefined) => {
        const next = view?.document;
        if (next?.id === this.document?.id) return;
        this.saveConversation();
        this.openDocument(next);
    };

    /** Swap to another document's history. Both sides of the switch tolerate a missing document. */
    private openDocument(document: IDocument | undefined) {
        this.document = document;
        this.conversations = document ? readConversations(document) : [];
        const latest = this.sortedConversations()[0];
        if (latest) this.openConversation(latest);
        else this.startConversation();
    }

    /**
     * Fold the in-flight conversation into the list and hand the list to the document. This
     * touches memory only — it reaches storage when the document itself is saved.
     */
    private saveConversation() {
        if (!this.document) return;
        if (this.conversation.messages.length > 0) {
            const index = this.conversations.findIndex((c) => c.id === this.conversation.id);
            if (index >= 0) this.conversations[index] = this.conversation;
            else this.conversations.push(this.conversation);
        }
        writeConversations(this.document, this.conversations);
    }

    /** Append one turn to the transcript, naming the conversation after its first question. */
    private recordMessage(message: StoredMessage): void {
        if (!this.conversation.title && message.role === "user") {
            this.conversation.title = conversationTitle(message.text);
        }
        this.conversation.messages.push(message);
        this.conversation.updatedAt = message.time;
    }

    private autosizeInput() {
        this.input.style.height = "auto";
        const height = Math.min(this.input.scrollHeight, 140);
        this.input.style.height = `${height}px`;
        this.input.style.overflowY = this.input.scrollHeight > 140 ? "auto" : "hidden";
    }

    private addImage(file: File) {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const comma = dataUrl.indexOf(",");
            const mediaType = dataUrl.slice(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";")) || file.type;
            this.pendingImages.push({ mediaType, data: dataUrl.slice(comma + 1) });
            this.renderImagePreview();
        };
        reader.readAsDataURL(file);
    }

    private renderImagePreview() {
        this.imagePreview.innerHTML = "";
        this.pendingImages.forEach((image, index) => {
            this.imagePreview.append(
                div(
                    { className: style.imageThumb },
                    img({
                        className: style.imageThumbImg,
                        src: `data:${image.mediaType};base64,${image.data}`,
                    }),
                    button({
                        className: style.imageThumbRemove,
                        textContent: "×",
                        onclick: () => {
                            this.pendingImages.splice(index, 1);
                            this.renderImagePreview();
                        },
                    }),
                ),
            );
        });
        this.imagePreview.style.display = this.pendingImages.length ? "flex" : "none";
    }

    private async send() {
        if (this.sending) return;
        const text = this.input.value.trim();
        if (!text) return;
        const config = this.configuredConfig();
        if (!config) return;

        this.sending = true;
        this.abortController = new AbortController();
        this.beginTurn(text);

        const assistantEl = this.appendAssistantPlaceholder();
        this.stream = {
            block: null,
            blockText: "",
            thinking: null,
            thinkingText: "",
            thinkingStartedAt: 0,
            raw: "",
        };
        let showFooter = false;
        try {
            await this.runTurn(config, this.abortController.signal);
            if (this.stream.raw) showFooter = true;
            else this.appendNoReply(assistantEl);
        } catch (err) {
            showFooter = this.handleSendError(err);
        } finally {
            this.endTurn(showFooter, assistantEl);
        }
    }

    /** A turn that streamed no text still owes the user an answer, even a placeholder one. */
    private appendNoReply(assistantEl: HTMLElement): void {
        this.clearThinking();
        assistantEl.append(div({ className: style.noReply, textContent: I18n.translate("ai.noReply") }));
    }

    /** Undo what beginTurn set up, once the reply has landed. */
    private endTurn(showFooter: boolean, assistantEl: HTMLElement): void {
        this.sealStream();
        this.clearThinking();
        const turn = this.settleTurn(assistantEl, showFooter);
        // Nothing worth a turn — no reply text, no cards, no question — leaves nothing behind.
        if (showFooter || turn.parts.length > 0) this.archiveTurn(turn);
        this.clearTurnState();
    }

    /**
     * Settle the finished turn: give its bubble the footer it earned, and read off what it leaves
     * for the transcript. `showFooter` is the caller's "the model said something" — the footer is
     * the only place a tool-only turn can report its elapsed time, so that case gets one too.
     */
    private settleTurn(assistantEl: HTMLElement, showFooter: boolean): SettledTurn {
        // A bubble no longer on screen leaves nothing to record. That is a run stopped while the
        // model was still reasoning: `handleSendError` takes the whole bubble down, because
        // reasoning with nothing said after it is not an answer — and the thinking part that
        // `sealStream` just pushed belongs to that bubble, not to the transcript.
        const parts = this.messageList.contains(assistantEl) ? this.turnParts : [];
        // `text` is `parts` read back, never a second tally of the same stream: a turn that
        // errored mid-way keeps the paragraphs it had already sealed, and a `text` built from the
        // raw stream would have dropped them along with the paragraph that was discarded.
        const text = parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
        // `undefined`, not 0, is what says the turn called nothing: a fast tool finishes inside
        // the same millisecond it started.
        const workedMs = parts.some((p) => p.type === "tool") ? Date.now() - this.turnStartedAt : undefined;
        if (showFooter || workedMs !== undefined) {
            assistantEl.append(this.messageFooter(text, Date.now(), workedMs));
        }
        return { parts, text, workedMs };
    }

    /** Put the settled turn into the conversation it belongs to, if it is still that one's. */
    private archiveTurn(turn: SettledTurn): void {
        // The turn belongs to a conversation only while the two still match: a switch mid-run
        // (new chat, restore, another document) leaves this one unwinding into nothing.
        if (this.turnConversation !== this.conversation) return;
        this.recordMessage({
            role: "assistant",
            text: turn.text,
            time: Date.now(),
            parts: turn.parts.length ? turn.parts : undefined,
            workedMs: turn.workedMs,
            usage: this.turnUsage,
        });
        this.saveConversation();
    }

    /** Drop everything the turn in flight was holding, and hand the panel back to idle. */
    private clearTurnState(): void {
        this.turnParts = [];
        this.turnUsage = undefined;
        this.turnConversation = undefined;
        this.activeAssistantEl = undefined;
        this.stream = undefined;
        this.sending = false;
        this.abortController = undefined;
        this.setStopMode(false);
        // The turn ending is the run's doing too: a reader who scrolled up to study something
        // keeps their place, and one who was following gets the last of the reply.
        if (this.isAtBottom()) this.scrollToBottom();
    }

    /** The config to run with, or undefined after sending the user to the settings overlay. */
    private configuredConfig(): LLMConfig | undefined {
        const config = currentConfig();
        if (config.apiKey) return config;
        this.configured = false;
        this.renderState();
        this.showSettings();
        return undefined;
    }

    /** Stream one answer into the placeholder, wiring the callbacks that render it live. */
    private async runTurn(config: LLMConfig, signal: AbortSignal): Promise<void> {
        await runAgent({
            config,
            system: buildSystemPrompt(),
            messages: this.messages,
            tools: buildTools(),
            signal,
            callbacks: {
                onTextDelta: (t) => this.handleTextDelta(t),
                onThinkingDelta: (t) => this.handleThinkingDelta(t),
                onUsage: (usage) => {
                    // Last one wins: within a turn each model round trip reports the window it
                    // read, and the last read is the fullest — it already holds the rounds before.
                    this.turnUsage = usage;
                    this.contextUsed = contextTokens(usage);
                    this.renderContextMeter();
                },
                onToolCall: (c) => {
                    // ask_user drew its own card while it waited (see askUser); agent.ts only reports
                    // the call once it resolves, so without this guard it would be drawn twice.
                    if (c.name === "ask_user") return;
                    this.appendToolCard(c.name, c.arguments, c.result);
                },
            },
        });
    }

    /** Lock the composer, record the user message and render its bubble. */
    private beginTurn(text: string) {
        this.turnConversation = this.conversation;
        this.turnStartedAt = Date.now();
        this.turnHistoryMark = this.document?.history.undoTop();
        this.turnUsage = undefined;
        this.setStopMode(true);
        this.input.value = "";
        this.autosizeInput();
        const images = this.pendingImages.splice(0, this.pendingImages.length);
        this.renderImagePreview();
        this.messages.push({ role: "user", content: text, images: images.length ? images : undefined });
        this.trimMessages();
        this.recordMessage({
            role: "user",
            text,
            time: Date.now(),
            images: images.length ? images : undefined,
        });
        this.appendBubble("user", text, images, { mark: this.turnHistoryMark });
        this.updateEmptyState();
    }

    private appendAssistantPlaceholder(): HTMLElement {
        const assistantEl = div({ className: style.assistant });
        this.messageList.append(assistantEl);
        this.activeAssistantEl = assistantEl;
        this.showThinking();
        this.scrollToBottom();
        return assistantEl;
    }

    private handleTextDelta(t: string) {
        const stream = this.stream;
        const assistantEl = this.activeAssistantEl;
        if (!stream || !assistantEl) return;
        // Read before the DOM grows: afterwards the metrics describe the taller layout, and the
        // reader who was being carried along would read as having scrolled away.
        const following = this.isAtBottom();
        if (!stream.block) {
            // The reply starting is what ends the reasoning that led to it.
            this.sealStream();
            stream.block = div({ className: style.markdown });
            assistantEl.append(stream.block);
            this.showThinking();
        }
        stream.blockText += t;
        stream.raw += t;
        stream.block.innerHTML = renderMarkdown(stream.blockText);
        if (following) this.scrollToBottom();
    }

    /**
     * Show reasoning as it streams, in a block that folds itself away once the model moves on.
     * The API sends this both as deltas and as a finished block; only the deltas reach here —
     * the block is what `parts.thinking` keeps for the replay.
     */
    private handleThinkingDelta(text: string) {
        const stream = this.stream;
        const assistantEl = this.activeAssistantEl;
        if (!stream || !assistantEl) return;
        const following = this.isAtBottom();
        if (!stream.thinking) {
            stream.thinking = this.buildThinkingBlock(I18n.translate("ai.thinking"), "");
            // Open while it streams: the point is watching the model work.
            stream.thinking.classList.add(style.open);
            stream.thinkingText = "";
            stream.thinkingStartedAt = Date.now();
            assistantEl.append(stream.thinking);
            this.showThinking();
        }
        stream.thinkingText += text;
        const body = stream.thinking.querySelector(`.${style.thinkingBody}`);
        if (body) {
            body.textContent = stream.thinkingText;
            // The block is capped in height and scrolls inside itself, so carrying the reader
            // along means carrying this too — the newest reasoning is the part being written.
            if (following) body.scrollTop = body.scrollHeight;
        }
        if (following) this.scrollToBottom();
    }

    /** A folded reasoning block; the caller opens it if it is the one streaming right now. */
    private buildThinkingBlock(summaryText: string, bodyText: string): HTMLElement {
        const summary = span({ className: style.thinkingSummary, textContent: summaryText });
        const body = div({ className: style.thinkingBody, textContent: bodyText });
        const root = div(
            { className: style.thinkingBlock },
            button(
                { className: style.thinkingHeader, onclick: () => root.classList.toggle(style.open) },
                summary,
                svg({ className: style.thinkingChevron, icon: "icon-angle-right" }),
            ),
            body,
        );
        return root;
    }

    /** A reasoning block redrawn from the transcript, folded away as `closeThinking` left it. */
    private thinkingPartElement(part: { text: string; ms?: number }): HTMLElement {
        return this.buildThinkingBlock(
            part.ms === undefined
                ? I18n.translate("ai.thinking")
                : I18n.translate("ai.thoughtFor", `${Math.round(part.ms / 1000)}s`),
            part.text,
        );
    }

    /** Fold the reasoning block away and record it, once the model has something to say. */
    private closeThinking() {
        const stream = this.stream;
        if (!stream?.thinking) return;
        const ms = Date.now() - stream.thinkingStartedAt;
        const summary = stream.thinking.querySelector(`.${style.thinkingSummary}`);
        if (summary) summary.textContent = I18n.translate("ai.thoughtFor", `${Math.round(ms / 1000)}s`);
        stream.thinking.classList.remove(style.open);
        this.turnParts.push({ type: "thinking", text: stream.thinkingText, ms });
        stream.thinking = null;
        stream.thinkingText = "";
    }

    /**
     * Seal whatever is streaming — reasoning and/or a paragraph — so the next part starts fresh.
     * This is what keeps a turn's blocks apart on either side of a tool call, in the DOM and in
     * the recorded parts alike.
     */
    private sealStream() {
        this.closeThinking();
        this.closeParagraph();
    }

    private closeParagraph() {
        const stream = this.stream;
        if (!stream?.block) return;
        this.turnParts.push({ type: "text", text: stream.blockText });
        stream.block = null;
        stream.blockText = "";
    }

    /** Throw away the half-written paragraph a crashed turn left, so the retry starts clean. */
    private discardParagraph() {
        const stream = this.stream;
        if (!stream?.block) return;
        stream.raw = stream.raw.slice(0, stream.raw.length - stream.blockText.length);
        stream.block.remove();
        stream.block = null;
        stream.blockText = "";
    }

    private clearThinking() {
        this.thinkingEl?.remove();
        this.thinkingEl = undefined;
    }

    /**
     * Show the waiting dots under whatever just landed. With the turn's parts flat, they are the
     * only thing saying a run is still going: a tool that reports late would otherwise leave the
     * transcript looking finished between two cards.
     *
     * They are built on demand rather than once per turn, because a question takes the run off
     * the model's hands mid-turn — `askUser` takes them down, and the answer has to put them back.
     */
    private showThinking() {
        const assistantEl = this.activeAssistantEl;
        if (!assistantEl) return;
        this.thinkingEl ??= div(
            { className: style.thinkingDots },
            span({ className: style.thinkingDot }),
            span({ className: style.thinkingDot }),
            span({ className: style.thinkingDot }),
        );
        assistantEl.append(this.thinkingEl);
    }

    /** Returns true when the (partial) reply should still get a footer. */
    private handleSendError(err: unknown): boolean {
        this.clearThinking();
        if (this.abortController?.signal.aborted) {
            // Interrupted by the user: keep whatever already streamed, drop an empty bubble.
            if (!this.stream?.raw && this.turnParts.length === 0) {
                this.activeAssistantEl?.remove();
                return false;
            }
            return !!this.stream?.raw;
        }
        this.discardParagraph();
        this.appendError((err as Error).message);
        return false;
    }

    private scrollToBottom() {
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }

    /**
     * Whether the reader is at the bottom of the transcript, and so wants to be carried along as
     * it grows. Read BEFORE the content that would move it: a delta that has already landed makes
     * the layout taller, and someone who was being carried along then reads as having scrolled away.
     */
    private isAtBottom(): boolean {
        const { scrollTop, scrollHeight, clientHeight } = this.messageList;
        return scrollHeight - scrollTop - clientHeight <= FOLLOW_BOTTOM_SLACK;
    }

    private interrupt() {
        this.abortController?.abort();
    }

    private setStopMode(stop: boolean) {
        setSVGIcon(this.sendIconEl, stop ? "icon-square" : "icon-up");
        this.sendButton.title = I18n.translate(stop ? "ai.stop" : "ai.sendHint");
        this.sendButton.classList.toggle(style.stopButton, stop);
    }

    /**
     * Bound the history resent to the model to the window the user configured, less slack: keep
     * the newest turns that fit in CONTEXT_BUDGET_RATIO of it. Counting messages instead — a flat
     * 40, say — has no relation to the window: the same 40 are 2% of a 1M context and over it in a
     * 32k one, so it either starves short conversations or overruns long ones.
     *
     * Two things are not negotiable whatever the budget. Base64 images are stripped from all but
     * the latest message that carries them — a screenshot is worth more than every message around
     * it. And the kept window never starts mid tool-exchange: walk forward to the next user
     * boundary so assistant tool_calls and their tool results stay paired, or are dropped together.
     */
    private trimMessages() {
        let lastWithImages = -1;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i];
            if (m.role !== "assistant" && m.images?.length) {
                lastWithImages = i;
                break;
            }
        }
        for (const [i, m] of this.messages.entries()) {
            if (m.role !== "assistant" && i !== lastWithImages && m.images) m.images = undefined;
        }

        const budget = (currentConfig().contextWindow ?? DEFAULT_CONTEXT_WINDOW) * CONTEXT_BUDGET_RATIO;
        let total = estimateContext(this.messages);
        if (total <= budget) return;

        // Always keep the newest message, even alone over budget: an empty context answers nothing.
        let start = 0;
        while (start < this.messages.length - 1 && total > budget) {
            total -= estimateTokens(this.messages[start]);
            start++;
        }
        while (start < this.messages.length && this.messages[start].role !== "user") start++;
        this.messages.splice(0, start);
        this.showContextNotice();
    }

    /**
     * Say once, at the top of the transcript, that the conversation has outgrown what the model
     * is sent. Without it the model simply starts forgetting earlier turns and nothing on screen
     * explains why — the transcript still shows every message, because the user gets to keep them.
     */
    private showContextNotice() {
        if (this.contextNoticeEl) return;
        this.contextNoticeEl = div({
            className: style.contextNotice,
            textContent: I18n.translate("ai.contextTrimmed"),
        });
        this.messageList.prepend(this.contextNoticeEl);
    }

    /**
     * One message bubble. A user bubble from this session also carries a revert control, out of
     * sight until the pointer is on it — the way back to "let me rephrase that" without retyping.
     * Restored transcripts pass no `revertTo`, having nothing in the document's stack to rewind —
     * and `mark` being empty is not the same as that: a turn sent against an empty stack is still
     * one this session can take back, and taking it back means undoing all of it.
     */
    private appendBubble(
        role: "user" | "assistant",
        text: string,
        images?: ImagePart[],
        revertTo?: { mark: IHistoryRecord | undefined },
    ): HTMLElement {
        const bubble = div({ className: role === "user" ? style.user : style.assistant }, text);
        for (const image of images ?? []) {
            bubble.append(
                img({ className: style.bubbleImage, src: `data:${image.mediaType};base64,${image.data}` }),
            );
        }
        if (role !== "user") {
            this.messageList.append(bubble);
            return bubble;
        }
        // Every user bubble gets the row, reverted turns included: the row is what holds the
        // bubble against the right edge, and only the control inside it is conditional.
        const children: HTMLElement[] = [];
        if (revertTo) {
            children.push(
                button(
                    {
                        className: style.userUndo,
                        type: "button",
                        title: I18n.translate("ai.undoHint"),
                        onclick: () => this.revertToTurn({ mark: revertTo.mark, text, images, el: row }),
                    },
                    svg({ className: style.userUndoIcon, icon: "icon-undo" }),
                ),
            );
        }
        children.push(bubble);
        const row = div({ className: style.userRow }, ...children);
        this.messageList.append(row);
        return row;
    }

    private messageFooter(raw: string, time: number = Date.now(), workedMs?: number) {
        return div(
            { className: style.msgFooter },
            button(
                {
                    className: style.copyButton,
                    title: I18n.translate("ai.copy"),
                    onclick: () => void navigator.clipboard?.writeText(raw)?.catch(() => {}),
                },
                svg({ className: style.copyIcon, icon: "icon-copy2" }),
            ),
            ...(workedMs === undefined
                ? []
                : [
                      span({
                          className: style.msgWorked,
                          textContent: I18n.translate("ai.workedFor", `${Math.round(workedMs / 1000)}s`),
                      }),
                  ]),
            span({
                className: style.msgTime,
                textContent: new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            }),
        );
    }

    /**
     * Take a turn back — and every turn after it. The document is one stack, so reaching an older
     * turn brings the newer ones with it; the transcript and the model's context have to come
     * along, or the model would be answering a question that is no longer on screen.
     */
    private revertToTurn(turn: RevertedTurn) {
        // A run still in flight would write its tail back into what is being taken away, so cut it
        // loose first: clearing the conversation is what `endTurn` reads as "this turn is nobody's".
        if (this.sending) {
            this.turnConversation = undefined;
            this.interrupt();
        }

        this.rewindDocument(turn.mark);
        this.dropTranscriptFrom(turn.el);
        this.syncPanelAfterRevert(turn);
    }

    /**
     * Undo the document back to where the turn began.
     *
     * To the mark, not to a counted number of steps: the stack is capped, so once it is full
     * `undoCount` stops rising and a count reads "nothing to rewind" for exactly the turns that
     * added the most. The depth is the backstop for a mark a manual undo took off the stack
     * mid-run — there is nothing left to aim at then, and going to the bottom beats leaving the
     * document holding work the transcript no longer shows.
     */
    private rewindDocument(mark: IHistoryRecord | undefined): void {
        const history = this.document?.history;
        if (!history) return;
        while (history.undoTop() !== mark && history.undoCount() > 0) history.undo();
        this.document?.visual.update();
    }

    /**
     * Take the transcript back to `el`, the row of the turn being reverted — and the model's
     * context with it. The rows and both message lists are appended in step, so the Nth row from
     * the end is the Nth user message from the end in each; an index would not survive
     * `trimMessages` dropping the front of the context.
     */
    private dropTranscriptFrom(el: HTMLElement): void {
        let rounds = 0;
        while (this.messageList.lastElementChild) {
            const node = this.messageList.lastElementChild;
            node.remove();
            if (node.classList.contains(style.userRow)) rounds++;
            if (node === el) break;
        }
        for (let i = 0; i < rounds; i++) {
            this.dropLastRound(this.messages);
            this.dropLastRound(this.conversation.messages);
        }
    }

    /** Bring the panel back in step with the transcript that survived the revert. */
    private syncPanelAfterRevert(turn: RevertedTurn): void {
        // The window shrank with the transcript. Nothing can measure it now — the next response
        // will — so estimate, rather than leave the meter reading a size that no longer exists.
        this.contextUsed = estimateContext(this.messages);
        this.renderContextMeter();

        // The marker claimed "everything above is outside the model's window" for a transcript
        // that no longer has that shape; the next send reassesses and puts it back if it holds.
        this.contextNoticeEl?.remove();
        this.contextNoticeEl = undefined;

        // The message is back in the box, ready to be said differently.
        this.input.value = turn.text;
        this.autosizeInput();
        for (const image of turn.images ?? []) this.pendingImages.push(image);
        this.renderImagePreview();

        this.saveConversation();
        this.updateEmptyState();
        this.scrollToBottom();
    }

    /** Drop one turn's user message and everything the model said in response to it. */
    private dropLastRound(list: { role: string }[]) {
        while (list.length > 0) {
            if (list.pop()?.role === "user") break;
        }
    }

    /** Append a tool card to the turn, right where the call happened. */
    private appendToolCard(name: string, args: string, result?: string) {
        this.sealStream();
        const tool: StoredToolCall = { name, args, result };
        this.turnParts.push({ type: "tool", ...tool });
        this.activeAssistantEl?.append(this.toolCardElement(tool));
        this.showThinking();
        // A card landing is the run's own doing, so it carries a reader only if they were already
        // at the bottom — the same rule the deltas follow.
        if (this.isAtBottom()) this.scrollToBottom();
    }

    private toolCardElement(tool: StoredToolCall): HTMLElement {
        const isError = tool.result ? this.parseToolResult(tool.result).isError : false;
        const card = div({ className: isError ? `${style.toolCard} ${style.open}` : style.toolCard });
        const header = button(
            {
                className: style.toolHeader,
                onclick: () => card.classList.toggle(style.open),
            },
            svg({
                className: isError ? `${style.toolStatus} ${style.toolStatusError}` : style.toolStatus,
                icon: isError ? "icon-times" : "icon-check",
            }),
            span({ className: style.toolName, textContent: tool.name }),
            svg({ className: style.toolChevron, icon: "icon-angle-down" }),
        );
        card.append(header, div({ className: style.toolBody }, this.toolDetail(tool)));
        return card;
    }

    /** A card's detail line, with the nodes it names clickable — the card's one way into the model. */
    private toolDetail(tool: StoredToolCall): HTMLElement {
        const segments = tool.result ? this.parseToolResult(tool.result).segments : [{ text: tool.args }];
        return div(
            { className: style.toolResult },
            ...segments.flatMap((segment, index) => {
                const ids = segment.nodeIds;
                const line = ids?.length
                    ? span({
                          className: style.toolLink,
                          textContent: segment.text,
                          title: I18n.translate("ai.tool.reveal"),
                          onclick: () => this.revealNodes(ids),
                      })
                    : span({ textContent: segment.text });
                return index === 0 ? [line] : [span({ textContent: "; " }), line];
            }),
        );
    }

    /**
     * Select the nodes a card names and frame them, so "what did it actually make" is one click
     * rather than a scroll through the project tree.
     */
    private revealNodes(ids: string[]) {
        const document = this.document;
        if (!document) return;
        const nodes = ids
            .map((id) => findNode(document, id))
            .filter((node): node is INode => node !== undefined);
        if (nodes.length === 0) return;
        document.selection.setSelectedNodes(nodes, false);
        document.application?.activeView?.cameraController.fitContent({ duration: CAMERA_FLY_DURATION });
    }

    /**
     * Put a question in the transcript and wait for the answer. The returned promise is what
     * ask_user's handler awaits, so the agent loop parks here until the user replies — every
     * path that abandons a turn (stop, new chat, restore, another document) must settle it,
     * or the run never finishes.
     */
    private askUser(request: AskRequest, signal?: AbortSignal): Promise<string> {
        this.sealStream();
        this.clearThinking();
        const card = this.buildAskCard(request);
        this.pinAskCard(card);

        return new Promise<string>((resolve) => {
            // Settles once: the guard lets a late abort land harmlessly after an answer, which is
            // what keeps this free of any listener bookkeeping.
            const settle = (answer: string, recorded: string = answer, resume = true) => {
                if (this.settleAsk !== settle) return;
                this.settleAsk = undefined;
                this.turnParts.push({
                    type: "ask",
                    question: request.question,
                    options: request.options,
                    answer: recorded,
                });
                this.markAskAnswered(card, recorded);
                this.unpinAskCard(card);
                // An answer hands the run back to the model, which then takes a round trip before
                // its next word. Put the dots back, or the transcript reads finished meanwhile.
                if (resume) this.showThinking();
                resolve(answer);
            };
            // Interrupted: the model gets a protocol line, the transcript gets a readable marker.
            const onAbort = () => settle(ASK_INTERRUPTED, I18n.translate("ai.ask.notAnswered"), false);
            this.settleAsk = settle;
            if (signal?.aborted) onAbort();
            else signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    /**
     * Stand the question in the composer's place. The run is blocked on the answer, so the bottom
     * of the panel — where the user's hands already are — is where it belongs; in the transcript
     * it would drift out of view behind a long turn.
     */
    private pinAskCard(card: HTMLElement) {
        this.composerCard.style.display = "none";
        this.composer.append(card);
        this.scrollToBottom();
    }

    /** Give the composer back, and leave the answered card in the transcript where it was asked. */
    private unpinAskCard(card: HTMLElement) {
        this.composerCard.style.display = "";
        if (this.activeAssistantEl) this.activeAssistantEl.append(card);
        else card.remove();
        this.scrollToBottom();
    }

    private buildAskCard(request: AskRequest): HTMLElement {
        const card = div({ className: style.askCard }, this.buildAskHeader(request));
        const options = request.options ?? [];
        if (options.length) card.append(this.buildAskOptions(options));
        card.append(this.buildAskInputRow());
        return card;
    }

    /**
     * The question, and the way out of it. Owning the composer means owning the composer's stop
     * button too: without it the user has no way out of a question they do not want to answer.
     */
    private buildAskHeader(request: AskRequest): HTMLElement {
        return div(
            { className: style.askHeader },
            div({ className: style.askQuestion, textContent: request.question }),
            button(
                {
                    className: style.askStop,
                    title: I18n.translate("ai.stop"),
                    onclick: () => this.interrupt(),
                },
                svg({ className: style.askStopIcon, icon: "icon-times" }),
            ),
        );
    }

    /** The offered answers, one button each. */
    private buildAskOptions(options: readonly string[]): HTMLElement {
        const row = div({ className: style.askOptions });
        for (const option of options) {
            row.append(
                button({
                    className: style.askOption,
                    textContent: option,
                    onclick: () => this.settleAsk?.(option),
                }),
            );
        }
        return row;
    }

    /**
     * The free-text answer row, carrying the composer's own send control rather than a second
     * look-alike: the question stands in for the composer, so the way out of it is the button the
     * user has already learned.
     */
    private buildAskInputRow(): HTMLElement {
        const answerInput = input({
            className: style.askInput,
            placeholder: I18n.translate("ai.ask.placeholder"),
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && !e.isComposing) {
                    e.preventDefault();
                    this.submitAsk(answerInput);
                }
            },
        });
        return div(
            { className: style.askInputRow },
            answerInput,
            button(
                {
                    className: style.sendButton,
                    type: "button",
                    title: I18n.translate("ai.send"),
                    onclick: () => this.submitAsk(answerInput),
                },
                svg({ className: style.sendIcon, icon: "icon-up" }),
            ),
        );
    }

    private submitAsk(input: HTMLInputElement) {
        const answer = input.value.trim();
        if (answer) this.settleAsk?.(answer);
    }

    /** Freeze the card: the question stays readable, the controls give way to the answer. */
    private markAskAnswered(card: HTMLElement, answer: string) {
        card.classList.add(style.askAnswered);
        card.querySelector(`.${style.askOptions}`)?.remove();
        card.querySelector(`.${style.askInputRow}`)?.remove();
        card.querySelector(`.${style.askStop}`)?.remove();
        card.append(div({ className: style.askAnswer, textContent: answer }));
    }

    /** A finished question redrawn from the transcript, in the shape `markAskAnswered` leaves. */
    private askCardElement(ask: StoredAsk): HTMLElement {
        return div(
            { className: `${style.askCard} ${style.askAnswered}` },
            div({ className: style.askQuestion, textContent: ask.question }),
            div({ className: style.askAnswer, textContent: ask.answer }),
        );
    }

    /** Summarize a tool result JSON into one display line; non-JSON passes through verbatim. */
    private parseToolResult(result: string): { segments: ResultSegment[]; isError: boolean } {
        try {
            const parsed = JSON.parse(result) as ToolResultSummary;
            if (parsed.error) {
                return {
                    segments: [{ text: I18n.translate("ai.error.prefix", parsed.error) }],
                    isError: true,
                };
            }
            return { segments: summarizeResult(parsed, result), isError: false };
        } catch {
            return { segments: [{ text: result }], isError: false };
        }
    }

    private appendError(message: string) {
        this.messageList.append(
            div({ className: style.error, textContent: I18n.translate("ai.error.prefix", message) }),
        );
    }
}

/** The stored projection as model context: text and images, no thinking, no tool exchanges. */
function toChatMessage(message: StoredMessage): ChatMessage {
    if (message.role === "user") {
        return { role: "user", content: message.text, images: message.images };
    }
    return { role: "assistant", content: message.text };
}

customElements.define("chili-ai-chat", ChatPanel);
