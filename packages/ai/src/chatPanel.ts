// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    getCurrentApplication,
    I18n,
    type I18nKeys,
    type IDocument,
    type IView,
    Localize,
    PubSub,
} from "@chili3d/core";
import { button, div, form, img, input, option, select, span, svg, textarea } from "@chili3d/element";
import { marked, type Tokens } from "marked";
import style from "./chatPanel.module.css";
import {
    conversationTitle,
    newConversation,
    readConversations,
    type StoredAsk,
    type StoredConversation,
    type StoredMessage,
    type StoredToolCall,
    writeConversations,
} from "./history";
import { runAgent } from "./llm/agent";
import { buildSystemPrompt } from "./llm/prompt";
import type { ChatMessage, ImagePart } from "./llm/types";
import {
    DEFAULT_ANTHROPIC_MODEL,
    type LLMConfig,
    loadConfig,
    PROVIDER_PRESETS,
    saveConfig,
} from "./settings";
import { buildTools } from "./tools";
import { type AskRequest, setAskHandler } from "./tools/askUser";

/** How many messages of history are resent to the model on each turn. */
const MAX_HISTORY_MESSAGES = 40;

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

/** Mutable state of the assistant text streaming in during one turn. */
/** The parts of a tool result a chat card summarizes; anything else falls back to the raw text. */
interface ToolResultSummary {
    ref?: string;
    created?: { nodeId?: string; name?: string }[];
    removed?: { nodeId?: string; name?: string }[];
    error?: string;
}

function summarizeResult(parsed: ToolResultSummary, fallback: string): string {
    const names = (nodes: { nodeId?: string; name?: string }[]) =>
        nodes
            .map((n) => n.name ?? n.nodeId ?? "")
            .filter(Boolean)
            .join(", ");

    const segments: string[] = [];
    if (parsed.created?.length) {
        segments.push(I18n.translate("ai.tool.created", names(parsed.created)));
    }
    if (parsed.removed?.length) {
        segments.push(I18n.translate("ai.tool.removed", names(parsed.removed)));
    }
    if (segments.length) return segments.join("; ");
    return parsed.ref ? I18n.translate("ai.tool.created", parsed.ref) : fallback;
}

interface StreamState {
    el: HTMLElement | null;
    raw: string;
}

export class ChatPanel extends HTMLElement {
    readonly header: HTMLElement;
    onClose?: () => void;
    onDock?: () => void;

    private readonly messages: ChatMessage[] = [];
    private readonly messageList: HTMLElement;
    private readonly emptyState: HTMLElement;
    private readonly composer: HTMLElement;
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
    /** Tool cards from the turn in flight, projected onto its assistant message when it ends. */
    private turnTools: StoredToolCall[] = [];
    /** Questions asked during the turn in flight, likewise projected when it ends. */
    private turnAsks: StoredAsk[] = [];
    /**
     * The assistant bubble of the turn in flight. Work blocks and question cards both anchor
     * before it, so the turn reads top-down as well as the DOM order does.
     */
    private activeAssistantEl?: HTMLElement;
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
    private apiKeyInput!: HTMLInputElement;
    private usernameInput!: HTMLInputElement;
    private readonly imagePreview: HTMLElement;
    private readonly pendingImages: ImagePart[] = [];
    private configured = false;
    private sending = false;
    private abortController?: AbortController;
    private sendIconEl!: HTMLElement;
    private workBlock?: {
        root: HTMLElement;
        body: HTMLElement;
        summary: HTMLElement;
        startedAt: number;
    };

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
        this.openDocument(activeDocument());
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
        this.sendIconEl = span({ className: style.sendIcon, textContent: "↑" });
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
        return div(
            { className: style.composer },
            div(
                { className: style.composerCard },
                this.input,
                div({ className: style.composerBar }, attachButton, this.sendButton),
            ),
        );
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

        this.providerSelect.onchange = () => this.fillFromPreset();
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

    private fillFromPreset() {
        const preset = PROVIDER_PRESETS.find((p) => p.id === this.providerSelect?.value);
        if (preset && this.baseURLInput && this.modelInput) {
            this.baseURLInput.value = preset.baseURL ?? "";
            this.modelInput.value = preset.defaultModel;
            if (this.usernameInput) this.usernameInput.value = preset.id;
        }
    }

    private showSettings() {
        if (!this.settingsOverlay) return;
        const saved = loadConfig();
        if (saved && this.providerSelect && this.baseURLInput && this.modelInput && this.apiKeyInput) {
            const preset = PROVIDER_PRESETS.find((p) => p.provider === saved.provider);
            if (preset) this.providerSelect.value = preset.id;
            this.baseURLInput.value = saved.baseURL ?? "";
            this.modelInput.value = saved.model;
            this.apiKeyInput.value = saved.apiKey;
            if (this.usernameInput) this.usernameInput.value = preset?.id ?? saved.provider;
        } else {
            this.fillFromPreset();
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
            apiKey: this.apiKeyInput?.value.trim() ?? "",
        };
        saveConfig(config);
        await this.offerKeyToPasswordManager(preset?.id ?? config.provider, config.apiKey);
        this.configured = config.apiKey.length > 0;
        this.renderState();
        this.hideSettings();
    }

    /**
     * Hand the key to the browser's password manager (Chrome/Edge support the
     * Credential Management API). Unsupported browsers or a declined prompt leave
     * the key session-only, and the user re-enters it next time.
     */
    private async offerKeyToPasswordManager(id: string, password: string) {
        if (!password) return;
        try {
            const ctor = (
                globalThis as {
                    PasswordCredential?: new (data: { id: string; password: string }) => Credential;
                }
            ).PasswordCredential;
            if (ctor && navigator.credentials?.store) {
                await navigator.credentials.store(new ctor({ id, password }));
            }
        } catch {
            // Declined or blocked — session-only it is.
        }
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
        this.turnTools = [];
        this.messageList.innerHTML = "";
        this.workBlock = undefined;
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
        this.workBlock = undefined;
        for (const message of conversation.messages) {
            if (message.role === "user") {
                this.appendBubble("user", message.text, message.images);
                continue;
            }
            const el = div({ className: style.assistant });
            this.messageList.append(el);
            if (message.tools?.length) {
                // The work block is a single slot: fill it and finalize before the next turn, or
                // the following turn's cards land inside this one.
                this.ensureWorkBlock(el, {
                    summary: I18n.translate("ai.workedFor", `${Math.round((message.workedMs ?? 0) / 1000)}s`),
                    open: false,
                });
                for (const tool of message.tools) {
                    this.appendToolCard(tool.name, tool.args, tool.result);
                }
                this.finalizeWorkBlock(true);
            }
            for (const ask of message.asks ?? []) {
                this.messageList.insertBefore(this.askCardElement(ask), el);
            }
            if (message.text) {
                el.append(div({ className: style.markdown, innerHTML: renderMarkdown(message.text) }));
            }
            el.append(this.messageFooter(message.text, message.time));
        }
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

    private currentConfig(): LLMConfig {
        return (
            loadConfig() ?? {
                provider: "anthropic",
                baseURL: undefined,
                apiKey: "",
                model: DEFAULT_ANTHROPIC_MODEL,
            }
        );
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

        const { assistantEl, thinkingEl } = this.appendAssistantPlaceholder();
        const stream: StreamState = { el: null, raw: "" };
        let showFooter = false;
        try {
            await this.runTurn(config, this.abortController.signal, stream, assistantEl, thinkingEl);
            if (stream.el) {
                showFooter = true;
            } else {
                this.appendNoReply(assistantEl, thinkingEl);
            }
        } catch (err) {
            showFooter = this.handleSendError(err, stream, thinkingEl, assistantEl);
        } finally {
            this.endTurn(showFooter, stream, assistantEl);
        }
    }

    /** A turn that streamed no text still owes the user an answer, even a placeholder one. */
    private appendNoReply(assistantEl: HTMLElement, thinkingEl: HTMLElement): void {
        thinkingEl.remove();
        assistantEl.append(div({ className: style.noReply, textContent: I18n.translate("ai.noReply") }));
    }

    /** Undo what beginTurn set up, once the reply has landed. */
    private endTurn(showFooter: boolean, stream: StreamState, assistantEl: HTMLElement): void {
        if (showFooter && stream.el) assistantEl.append(this.messageFooter(stream.raw));
        const workedMs = this.workBlock ? Date.now() - this.workBlock.startedAt : 0;
        this.finalizeWorkBlock();
        const hasContent = showFooter || this.turnTools.length > 0 || this.turnAsks.length > 0;
        // The turn belongs to a conversation only while the two still match: a switch mid-run
        // (new chat, restore, another document) leaves this one unwinding into nothing.
        if (this.turnConversation === this.conversation && hasContent) {
            this.recordMessage({
                role: "assistant",
                text: showFooter ? stream.raw : "",
                time: Date.now(),
                tools: this.turnTools.length ? this.turnTools : undefined,
                asks: this.turnAsks.length ? this.turnAsks : undefined,
                workedMs: workedMs || undefined,
            });
            this.saveConversation();
        }
        this.turnTools = [];
        this.turnAsks = [];
        this.turnConversation = undefined;
        this.activeAssistantEl = undefined;
        this.sending = false;
        this.abortController = undefined;
        this.setStopMode(false);
        this.scrollToBottom();
    }

    /** The config to run with, or undefined after sending the user to the settings overlay. */
    private configuredConfig(): LLMConfig | undefined {
        const config = this.currentConfig();
        if (config.apiKey) return config;
        this.configured = false;
        this.renderState();
        this.showSettings();
        return undefined;
    }

    /** Stream one answer into the placeholder, wiring the callbacks that render it live. */
    private async runTurn(
        config: LLMConfig,
        signal: AbortSignal,
        stream: StreamState,
        assistantEl: HTMLElement,
        thinkingEl: HTMLElement,
    ): Promise<void> {
        await runAgent({
            config,
            system: buildSystemPrompt(),
            messages: this.messages,
            tools: buildTools(),
            signal,
            callbacks: {
                onTextDelta: (t) => this.handleTextDelta(t, stream, thinkingEl, assistantEl),
                onToolCall: (c) => {
                    // ask_user drew its own card while it waited (see askUser); agent.ts only reports
                    // the call once it resolves, so without this guard it would be drawn twice.
                    if (c.name === "ask_user") return;
                    this.turnTools.push({ name: c.name, args: c.arguments, result: c.result });
                    this.ensureWorkBlock(assistantEl);
                    this.appendToolCard(c.name, c.arguments, c.result);
                },
            },
        });
    }

    /** Lock the composer, record the user message and render its bubble. */
    private beginTurn(text: string) {
        this.turnConversation = this.conversation;
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
        this.appendBubble("user", text, images);
        this.updateEmptyState();
    }

    private appendAssistantPlaceholder() {
        const assistantEl = div({ className: style.assistant });
        const thinkingEl = div(
            { className: style.thinkingDots },
            span({ className: style.thinkingDot }),
            span({ className: style.thinkingDot }),
            span({ className: style.thinkingDot }),
        );
        assistantEl.append(thinkingEl);
        this.messageList.append(assistantEl);
        this.activeAssistantEl = assistantEl;
        this.scrollToBottom();
        return { assistantEl, thinkingEl };
    }

    private handleTextDelta(
        t: string,
        stream: StreamState,
        thinkingEl: HTMLElement,
        assistantEl: HTMLElement,
    ) {
        if (!stream.el) {
            thinkingEl.remove();
            stream.el = div({ className: style.markdown });
            assistantEl.append(stream.el);
        }
        stream.raw += t;
        stream.el.innerHTML = renderMarkdown(stream.raw);
        this.scrollToBottom();
    }

    /** Returns true when the (partial) reply should still get a footer. */
    private handleSendError(
        err: unknown,
        stream: StreamState,
        thinkingEl: HTMLElement,
        assistantEl: HTMLElement,
    ): boolean {
        thinkingEl.remove();
        if (this.abortController?.signal.aborted) {
            // Interrupted by the user: keep whatever already streamed, drop an empty bubble.
            if (stream.el) return true;
            assistantEl.remove();
            return false;
        }
        stream.el?.remove();
        this.appendError((err as Error).message);
        return false;
    }

    private scrollToBottom() {
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }

    private interrupt() {
        this.abortController?.abort();
    }

    private setStopMode(stop: boolean) {
        this.sendIconEl.textContent = stop ? "■" : "↑";
        this.sendButton.title = I18n.translate(stop ? "ai.stop" : "ai.sendHint");
        this.sendButton.classList.toggle(style.stopButton, stop);
    }

    /**
     * Bound the history resent to the model: keep the newest MAX_HISTORY_MESSAGES messages,
     * and strip base64 images from all but the latest message that carries them. Never start
     * the kept window mid tool-exchange — walk forward to the next user-message boundary so
     * assistant tool_calls and their tool results stay paired (or are dropped together).
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

        if (this.messages.length <= MAX_HISTORY_MESSAGES) return;
        let start = this.messages.length - MAX_HISTORY_MESSAGES;
        while (start < this.messages.length && this.messages[start].role !== "user") start++;
        this.messages.splice(0, start);
    }

    private appendBubble(role: "user" | "assistant", text: string, images?: ImagePart[]) {
        const el = div({ className: role === "user" ? style.user : style.assistant }, text);
        for (const image of images ?? []) {
            el.append(
                img({ className: style.bubbleImage, src: `data:${image.mediaType};base64,${image.data}` }),
            );
        }
        this.messageList.append(el);
    }

    /**
     * Collapsible "worked for Ns" row above the assistant reply that groups the turn's tool
     * cards — expanded while running, collapsed once the turn finishes.
     */
    private ensureWorkBlock(anchor: HTMLElement, options?: { summary?: string; open?: boolean }) {
        if (this.workBlock) return;
        const summary = span({
            className: style.workSummary,
            textContent: options?.summary ?? I18n.translate("ai.working"),
        });
        const body = div({ className: style.workBody });
        const root = div({
            className: options?.open === false ? style.workBlock : `${style.workBlock} ${style.open}`,
        });
        root.append(
            button(
                { className: style.workHeader, onclick: () => root.classList.toggle(style.open) },
                summary,
                svg({ className: style.workChevron, icon: "icon-angle-right" }),
            ),
            body,
        );
        this.messageList.insertBefore(root, anchor);
        this.workBlock = { root, body, summary, startedAt: Date.now() };
    }

    private finalizeWorkBlock(keepSummary = false) {
        if (!this.workBlock) return;
        if (!keepSummary) {
            const seconds = Math.round((Date.now() - this.workBlock.startedAt) / 1000);
            this.workBlock.summary.textContent = I18n.translate("ai.workedFor", `${seconds}s`);
        }
        this.workBlock.root.classList.remove(style.open);
        this.workBlock = undefined;
    }

    private messageFooter(raw: string, time: number = Date.now()) {
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
            span({
                className: style.msgTime,
                textContent: new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            }),
        );
    }

    private appendToolCard(name: string, args: string, result?: string) {
        const { text: resultText, isError } = result
            ? this.parseToolResult(result)
            : { text: "", isError: false };
        const detail = resultText || args;
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
            span({ className: style.toolName, textContent: name }),
            svg({ className: style.toolChevron, icon: "icon-angle-down" }),
        );
        card.append(
            header,
            div({ className: style.toolBody }, div({ className: style.toolResult, textContent: detail })),
        );
        (this.workBlock?.body ?? this.messageList).append(card);
        this.scrollToBottom();
    }

    /**
     * Put a question in the transcript and wait for the answer. The returned promise is what
     * ask_user's handler awaits, so the agent loop parks here until the user replies — every
     * path that abandons a turn (stop, new chat, restore, another document) must settle it,
     * or the run never finishes.
     */
    private askUser(request: AskRequest, signal?: AbortSignal): Promise<string> {
        const card = this.buildAskCard(request);
        // Same anchor as work blocks: both belong before the assistant bubble of this turn.
        this.messageList.insertBefore(card, this.activeAssistantEl ?? null);
        this.scrollToBottom();

        return new Promise<string>((resolve) => {
            // Settles once: the guard lets a late abort land harmlessly after an answer, which is
            // what keeps this free of any listener bookkeeping.
            const settle = (answer: string, recorded: string = answer) => {
                if (this.settleAsk !== settle) return;
                this.settleAsk = undefined;
                this.turnAsks.push({
                    question: request.question,
                    options: request.options,
                    answer: recorded,
                });
                this.markAskAnswered(card, recorded);
                resolve(answer);
            };
            // Interrupted: the model gets a protocol line, the transcript gets a readable marker.
            const onAbort = () => settle(ASK_INTERRUPTED, I18n.translate("ai.ask.notAnswered"));
            this.settleAsk = settle;
            if (signal?.aborted) onAbort();
            else signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    private buildAskCard(request: AskRequest): HTMLElement {
        const card = div(
            { className: style.askCard },
            div({ className: style.askQuestion, textContent: request.question }),
        );
        const options = request.options ?? [];
        if (options.length) {
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
            card.append(row);
        }
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
        card.append(
            div(
                { className: style.askInputRow },
                answerInput,
                button({
                    className: style.askSend,
                    textContent: "↑",
                    onclick: () => this.submitAsk(answerInput),
                }),
            ),
        );
        return card;
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
    private parseToolResult(result: string): { text: string; isError: boolean } {
        try {
            const parsed = JSON.parse(result) as ToolResultSummary;
            if (parsed.error) {
                return { text: I18n.translate("ai.error.prefix", parsed.error), isError: true };
            }
            return { text: summarizeResult(parsed, result), isError: false };
        } catch {
            return { text: result, isError: false };
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

/** The active document, or undefined outside a running app (tests, detached panels). */
function activeDocument(): IDocument | undefined {
    try {
        return getCurrentApplication().activeView?.document;
    } catch {
        return undefined;
    }
}

customElements.define("chili-ai-chat", ChatPanel);

export function createChatPanel(): ChatPanel {
    return new ChatPanel();
}
