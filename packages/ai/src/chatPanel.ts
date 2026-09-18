// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, Localize } from "@chili3d/core";
import { button, div, form, img, input, option, select, span, svg, textarea } from "@chili3d/element";
import { marked, type Tokens } from "marked";
import style from "./chatPanel.module.css";
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

/** How many messages of history are resent to the model on each turn. */
const MAX_HISTORY_MESSAGES = 40;

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
    private clearButtonEl!: HTMLButtonElement;
    private headerButtons!: HTMLElement;
    private settingsOverlay?: HTMLElement;
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
        );
        this.loadConfig();
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
        this.clearButtonEl = this.headerButton("icon-clear", "ai.clear", () => this.clear());

        this.headerButtons = div(
            { className: style.headerButtons },
            this.settingsButtonEl,
            this.clearButtonEl,
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
                this.clearButtonEl,
                this.dockButtonEl,
                this.closeButtonEl,
            );
        }
    }

    /** Buttons hosted by the FloatPanel title bar while floating. */
    floatingActions(): HTMLElement[] {
        return [this.settingsButtonEl, this.clearButtonEl, this.dockButtonEl];
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

    private clear() {
        this.messages.length = 0;
        this.messageList.innerHTML = "";
        this.workBlock = undefined;
        this.pendingImages.length = 0;
        this.renderImagePreview();
        this.updateEmptyState();
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
        this.finalizeWorkBlock();
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
                    this.ensureWorkBlock(assistantEl);
                    this.appendToolCard(c.name, c.arguments, c.result);
                },
            },
        });
    }

    /** Lock the composer, record the user message and render its bubble. */
    private beginTurn(text: string) {
        this.setStopMode(true);
        this.input.value = "";
        this.autosizeInput();
        const images = this.pendingImages.splice(0, this.pendingImages.length);
        this.renderImagePreview();
        this.messages.push({ role: "user", content: text, images: images.length ? images : undefined });
        this.trimMessages();
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
    private ensureWorkBlock(anchor: HTMLElement) {
        if (this.workBlock) return;
        const summary = span({ className: style.workSummary, textContent: I18n.translate("ai.working") });
        const body = div({ className: style.workBody });
        const root = div({ className: `${style.workBlock} ${style.open}` });
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

    private finalizeWorkBlock() {
        if (!this.workBlock) return;
        const seconds = Math.round((Date.now() - this.workBlock.startedAt) / 1000);
        this.workBlock.summary.textContent = I18n.translate("ai.workedFor", `${seconds}s`);
        this.workBlock.root.classList.remove(style.open);
        this.workBlock = undefined;
    }

    private messageFooter(raw: string) {
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
                textContent: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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

customElements.define("chili-ai-chat", ChatPanel);

export function createChatPanel(): ChatPanel {
    return new ChatPanel();
}
