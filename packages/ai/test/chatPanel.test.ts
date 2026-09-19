// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, PubSub } from "@chili3d/core";
import { createMockDocument, mockLocalStorage } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ChatPanel } from "../src/chatPanel";
import {
    readConversations,
    type StoredConversation,
    type StoredMessage,
    writeConversations,
} from "../src/history";
import { loadConfig, saveConfig } from "../src/settings";
import { type AskRequest, setAskHandler } from "../src/tools/askUser";

const agentMock = rs.hoisted(() => {
    const pending: { resolve: () => void }[] = [];
    return {
        pending,
        runAgent: rs.fn((_opts: unknown) => new Promise<void>((resolve) => pending.push({ resolve }))),
    };
});

rs.mock("../src/llm/agent", () => ({ runAgent: agentMock.runAgent }));

rs.mock("../src/chatPanel.module.css", () => ({
    root: "root",
    messageList: "messageList",
    input: "input",
    sendButton: "sendButton",
    stopButton: "stopButton",
    title: "title",
    titleIcon: "titleIcon",
    iconButton: "iconButton",
    buttonIcon: "buttonIcon",
    header: "header",
    headerButtons: "headerButtons",
    imagePreview: "imagePreview",
    composer: "composer",
    composerCard: "composerCard",
    composerBar: "composerBar",
    sendIcon: "sendIcon",
    emptyState: "emptyState",
    emptyIcon: "emptyIcon",
    emptyTitle: "emptyTitle",
    emptyHint: "emptyHint",
    emptyAsk: "emptyAsk",
    attachButton: "attachButton",
    attachIcon: "attachIcon",
    imageThumb: "imageThumb",
    imageThumbImg: "imageThumbImg",
    imageThumbRemove: "imageThumbRemove",
    assistant: "assistant",
    noReply: "noReply",
    thinkingDots: "thinkingDots",
    thinkingDot: "thinkingDot",
    markdown: "markdown",
    user: "user",
    toolCard: "toolCard",
    toolHeader: "toolHeader",
    toolStatus: "toolStatus",
    toolStatusError: "toolStatusError",
    toolName: "toolName",
    toolChevron: "toolChevron",
    toolBody: "toolBody",
    toolResult: "toolResult",
    open: "open",
    workBlock: "workBlock",
    workHeader: "workHeader",
    workSummary: "workSummary",
    workChevron: "workChevron",
    workBody: "workBody",
    msgFooter: "msgFooter",
    copyButton: "copyButton",
    copyIcon: "copyIcon",
    msgTime: "msgTime",
    error: "error",
    bubbleImage: "bubbleImage",
    settingsOverlay: "settingsOverlay",
    settingsHeader: "settingsHeader",
    settingsTitle: "settingsTitle",
    settingsBody: "settingsBody",
    settingsField: "settingsField",
    settingsLabel: "settingsLabel",
    settingsHint: "settingsHint",
    settingsFooter: "settingsFooter",
    cancelButton: "cancelButton",
    field: "field",
    saveButton: "saveButton",
    historyOverlay: "historyOverlay",
    historyHeader: "historyHeader",
    historyTitle: "historyTitle",
    historyList: "historyList",
    historyEmpty: "historyEmpty",
    historyItem: "historyItem",
    historyItemActive: "historyItemActive",
    historyItemBody: "historyItemBody",
    historyItemTitle: "historyItemTitle",
    historyItemDate: "historyItemDate",
    historyItemDelete: "historyItemDelete",
    historyItemDeleteIcon: "historyItemDeleteIcon",
    askCard: "askCard",
    askAnswered: "askAnswered",
    askQuestion: "askQuestion",
    askOptions: "askOptions",
    askOption: "askOption",
    askInputRow: "askInputRow",
    askInput: "askInput",
    askSend: "askSend",
    askAnswer: "askAnswer",
}));

describe("ChatPanel", () => {
    beforeEach(() => {
        mockLocalStorage();
        agentMock.pending.length = 0;
        agentMock.runAgent.mock.calls.length = 0;
    });

    afterEach(() => {
        // Each panel subscribes for its whole life; drop them so panels outlive their test.
        PubSub.default.removeAll("activeViewChanged");
        setAskHandler(undefined);
    });

    test("ignores a re-entrant send while a run is in flight", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "make a box";
        const first: Promise<void> = anyPanel.send();

        anyPanel.input.value = "again";
        await anyPanel.send();

        expect(agentMock.runAgent.mock.calls.length).toBe(1);

        agentMock.pending[0].resolve();
        await first;
        expect(anyPanel.sending).toBe(false);
    });

    test("shows the dock button only when floating and routes clicks to onDock", () => {
        const panel = new ChatPanel();
        const dockButton = (panel as any).dockButtonEl as HTMLButtonElement;

        expect(dockButton.style.display).toBe("none");
        panel.setFloating(true);
        expect(dockButton.style.display).toBe("");
        panel.setFloating(false);
        expect(dockButton.style.display).toBe("none");

        panel.setFloating(true);
        let docked = 0;
        panel.onDock = () => docked++;
        dockButton.click();
        expect(docked).toBe(1);
    });

    test("hides its own header while floating and hands actions to the host title bar", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        expect(panel.header.style.display).toBe("");
        panel.setFloating(true);
        expect(panel.header.style.display).toBe("none");

        const actions = panel.floatingActions();
        expect(actions).toEqual([
            anyPanel.settingsButtonEl,
            anyPanel.historyButtonEl,
            anyPanel.newChatButtonEl,
            anyPanel.dockButtonEl,
        ]);

        // Simulate the host title bar taking over the actions, then docking back
        const host = document.createElement("div");
        host.append(...actions);
        expect(anyPanel.headerButtons.contains(anyPanel.settingsButtonEl)).toBe(false);

        panel.setFloating(false);
        expect(panel.header.style.display).toBe("");
        expect(anyPanel.headerButtons.contains(anyPanel.settingsButtonEl)).toBe(true);
        expect(anyPanel.headerButtons.contains(anyPanel.historyButtonEl)).toBe(true);
        expect(anyPanel.headerButtons.contains(anyPanel.newChatButtonEl)).toBe(true);
        expect(anyPanel.headerButtons.contains(anyPanel.dockButtonEl)).toBe(true);
        expect(anyPanel.headerButtons.contains(anyPanel.closeButtonEl)).toBe(true);
    });

    test("trims history to the newest messages and strips all but the latest images", () => {
        const panel = new ChatPanel();
        const messages = (panel as any).messages as any[];
        for (let i = 0; i < 45; i++) {
            messages.push({
                role: "user",
                content: `m${i}`,
                images: i % 10 === 0 ? [{ mediaType: "image/png", data: "x" }] : undefined,
            });
        }

        (panel as any).trimMessages();

        expect(messages.length).toBe(40);
        expect(messages[0].content).toBe("m5");
        const withImages = messages.filter((m) => m.images);
        expect(withImages.length).toBe(1);
        expect(withImages[0].content).toBe("m40");
    });

    test("trim cuts at a user boundary so tool_use/tool_result pairs stay intact", () => {
        const panel = new ChatPanel();
        const messages = (panel as any).messages as any[];
        messages.push({ role: "user", content: "old" });
        messages.push({
            role: "assistant",
            content: "",
            toolCalls: [{ id: "t1", name: "x", arguments: "{}" }],
        });
        messages.push({ role: "tool", toolCallId: "t1", name: "x", content: "{}" });
        for (let i = 0; i < 38; i++) messages.push({ role: "user", content: `m${i}` });

        (panel as any).trimMessages();

        expect(messages.length).toBe(38);
        expect(messages.every((m) => m.role === "user")).toBe(true);
    });

    test("scrolls the message list to the bottom immediately on send", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        let lastScrollTop = 0;
        const list = anyPanel.messageList as HTMLElement;
        Object.defineProperty(list, "scrollHeight", { get: () => 100, configurable: true });
        Object.defineProperty(list, "scrollTop", {
            get: () => lastScrollTop,
            set: (v) => {
                lastScrollTop = v;
            },
            configurable: true,
        });

        anyPanel.input.value = "hi";
        const pending = anyPanel.send();

        // Before the agent produces any output, the user's own message is in view
        expect(lastScrollTop).toBe(100);

        agentMock.pending.shift()?.resolve();
        await pending;
        expect(lastScrollTop).toBe(100);
    });

    test("shows a three-dot thinking indicator while the agent runs", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "hi";
        const pending = anyPanel.send();

        expect(panel.querySelectorAll(".thinkingDot").length).toBe(3);

        agentMock.pending.shift()!.resolve();
        await pending;
    });

    test("renders streamed text as markdown and escapes raw html", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("**bold** and `code`\n\n<img src=x onerror=alert(1)>");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "hi";
        await anyPanel.send();

        const md = panel.querySelector(".markdown");
        expect(md).not.toBeNull();
        expect(md!.innerHTML).toContain("<strong>bold</strong>");
        expect(md!.innerHTML).toContain("<code>code</code>");
        expect(md!.querySelector("img")).toBeNull();
        expect(md!.textContent).toContain("<img src=x onerror=alert(1)>");
        expect(panel.querySelector(".thinkingDot")).toBeNull();
    });

    test("tool cards show a summary row and toggle details on click", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({
                name: "run_program",
                arguments: "{}",
                result: JSON.stringify({ created: [{ name: "Box" }] }),
            });
            opts.callbacks.onTextDelta("done");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "make a box";
        await anyPanel.send();

        const card = panel.querySelector(".toolCard");
        expect(card).not.toBeNull();
        expect(card!.classList.contains("open")).toBe(false);
        // header shows only the tool name; details live in the collapsible body
        expect(card!.querySelector(".toolName")!.textContent).toBe("run_program");
        expect(card!.querySelector(".toolHeader")!.textContent).not.toContain("ai.tool.created");
        expect(card!.querySelector(".toolResult")!.textContent).toBe("ai.tool.created");

        (card!.querySelector(".toolHeader") as HTMLButtonElement).click();
        expect(card!.classList.contains("open")).toBe(true);
    });

    test("tool cards render created and removed nodes from run_program", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({
                name: "run_program",
                arguments: "{}",
                result: JSON.stringify({ created: [{ name: "Box" }], removed: [{ name: "Tool" }] }),
            });
            opts.callbacks.onTextDelta("done");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "cut a box";
        await anyPanel.send();

        const card = panel.querySelector(".toolCard");
        expect(card).not.toBeNull();
        expect(card!.querySelector(".toolResult")!.textContent).toBe("ai.tool.created; ai.tool.removed");
    });

    test("tool cards with an error result open by default", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({
                name: "run_program",
                arguments: "{}",
                result: JSON.stringify({ error: "Sketch profile is not closed" }),
            });
            opts.callbacks.onTextDelta("failed");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "bad sketch";
        await anyPanel.send();

        const card = panel.querySelector(".toolCard");
        expect(card).not.toBeNull();
        expect(card!.classList.contains("open")).toBe(true);
        expect(card!.querySelector(".toolStatusError")).not.toBeNull();
    });

    test("groups tool cards under a work row that finalizes with the elapsed time", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({ name: "run_program", arguments: "{}", result: "{}" });
            opts.callbacks.onTextDelta("done");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "make a box";
        await anyPanel.send();

        const work = panel.querySelector(".workBlock");
        expect(work).not.toBeNull();
        expect(work!.querySelector(".workSummary")!.textContent).toBe("ai.workedFor");
        // collapsed once the turn finishes
        expect(work!.classList.contains("open")).toBe(false);
        // tool cards live inside the collapsible work body
        expect(work!.querySelector(".workBody .toolCard")).not.toBeNull();

        (work!.querySelector(".workHeader") as HTMLButtonElement).click();
        expect(work!.classList.contains("open")).toBe(true);
    });

    test("shows a copy button and timestamp under a completed reply", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("hello");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "hi";
        await anyPanel.send();

        const footer = panel.querySelector(".msgFooter");
        expect(footer).not.toBeNull();
        expect(footer!.querySelector(".copyButton")).not.toBeNull();
        expect(footer!.querySelector(".msgTime")!.textContent).toMatch(/\d{1,2}:\d{2}/);
    });

    test("hides the message list while empty and reveals it on first send", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async () => {});
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        const list = panel.querySelector(".messageList") as HTMLElement;
        const empty = panel.querySelector(".emptyState") as HTMLElement;
        expect(list.style.display).toBe("none");
        expect(empty.style.display).toBe("flex");

        anyPanel.input.value = "hi";
        await anyPanel.send();

        expect(list.style.display).toBe("flex");
        expect(empty.style.display).toBe("none");
    });

    test("send button becomes a stop control while running and aborts the run", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("partial");
            await new Promise((_, reject) => {
                opts.signal.addEventListener("abort", () =>
                    reject(new DOMException("Aborted", "AbortError")),
                );
            });
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "hi";
        const pending = anyPanel.send();

        const sendButton = anyPanel.sendButton as HTMLButtonElement;
        expect(anyPanel.sendIconEl.textContent).toBe("■");
        expect(sendButton.disabled).toBe(false);
        expect(sendButton.classList.contains("stopButton")).toBe(true);

        sendButton.click();
        await pending;

        expect(anyPanel.sending).toBe(false);
        expect(anyPanel.abortController).toBeUndefined();
        expect(anyPanel.sendIconEl.textContent).toBe("↑");
        // the partially streamed reply is kept and gets a footer
        expect(panel.querySelector(".markdown")!.textContent).toContain("partial");
        expect(panel.querySelector(".msgFooter")).not.toBeNull();
    });

    test("interrupting before any text removes the empty bubble without an error", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            await new Promise((_, reject) => {
                opts.signal.addEventListener("abort", () =>
                    reject(new DOMException("Aborted", "AbortError")),
                );
            });
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "hi";
        const pending = anyPanel.send();
        (anyPanel.sendButton as HTMLButtonElement).click();
        await pending;

        expect(panel.querySelector(".assistant")).toBeNull();
        expect(panel.querySelector(".error")).toBeNull();
        expect(panel.querySelector(".thinkingDots")).toBeNull();
    });

    test("settings overlay opens over the panel, saves config, and shows the model badge", async () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        const overlay = panel.querySelector(".settingsOverlay") as HTMLElement;
        expect(overlay).not.toBeNull();
        expect(overlay.style.display).toBe("none");
        expect(anyPanel.configured).toBe(false);

        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        expect(overlay.style.display).toBe("flex");

        anyPanel.apiKeyInput.value = "sk-test";
        (overlay.querySelector("form") as HTMLFormElement).requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(overlay.style.display).toBe("none");
        expect(loadConfig()?.apiKey).toBe("sk-test");
        expect(anyPanel.configured).toBe(true);
        // The key must stay out of persistent storage
        expect(localStorage.getItem("chili3d.app.ai.config")).not.toContain("sk-test");
    });

    test("cancel closes the settings overlay without persisting", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        const overlay = panel.querySelector(".settingsOverlay") as HTMLElement;
        anyPanel.apiKeyInput.value = "sk-nope";
        (overlay.querySelector(".cancelButton") as HTMLButtonElement).click();

        expect(overlay.style.display).toBe("none");
        expect(loadConfig()).toBeUndefined();
        expect(anyPanel.configured).toBe(false);
    });

    test("settings form carries password-manager semantics", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        const inputs = Array.from(panel.querySelectorAll("input")) as HTMLInputElement[];
        const username = inputs.find((i) => i.autocomplete === "username");
        const password = inputs.find((i) => i.autocomplete === "current-password");
        expect(username).not.toBeUndefined();
        expect(password).not.toBeUndefined();
        expect(password?.type).toBe("password");
        expect(password?.closest("form")).not.toBeNull();
        expect(username?.closest("form")).toBe(password?.closest("form"));

        anyPanel.providerSelect.value = "openai";
        anyPanel.providerSelect.onchange?.(new Event("change"));
        expect(username?.value).toBe("openai");
    });

    test("offers the api key to the password manager when saving settings", async () => {
        const store = rs.fn(async (_cred: unknown) => undefined);
        class FakePasswordCredential {
            constructor(public data: { id: string; password: string }) {}
        }
        rs.stubGlobal("PasswordCredential", FakePasswordCredential);
        const originalCredentials = navigator.credentials;
        Object.defineProperty(navigator, "credentials", { value: { store }, configurable: true });
        try {
            const panel = new ChatPanel();
            const anyPanel = panel as any;
            anyPanel.apiKeyInput.value = "sk-live";
            anyPanel.modelInput.value = "m";
            await anyPanel.saveSettings();

            expect(store.mock.calls.length).toBe(1);
            const cred = store.mock.calls[0][0] as FakePasswordCredential;
            expect(cred.data).toEqual({ id: "anthropic", password: "sk-live" });
            expect(loadConfig()?.apiKey).toBe("sk-live");
        } finally {
            Object.defineProperty(navigator, "credentials", {
                value: originalCredentials,
                configurable: true,
            });
            rs.unstubAllGlobals();
        }
    });

    test("saving settings works when the Credential Management API is unavailable", async () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        anyPanel.apiKeyInput.value = "sk-session";
        anyPanel.modelInput.value = "m";
        await anyPanel.saveSettings();

        expect(loadConfig()?.apiKey).toBe("sk-session");
        expect(anyPanel.configured).toBe(true);
        expect(localStorage.getItem("chili3d.app.ai.config")).not.toContain("sk-session");
    });

    test("enter inserts a newline, ctrl+enter sends", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        anyPanel.input.value = "hi";

        const pressEnter = (init: KeyboardEventInit) =>
            anyPanel.input.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", cancelable: true, ...init }),
            );

        pressEnter({});
        pressEnter({ shiftKey: true });
        expect(agentMock.runAgent.mock.calls.length).toBe(0);

        pressEnter({ ctrlKey: true });
        expect(agentMock.runAgent.mock.calls.length).toBe(1);

        agentMock.pending.shift()?.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
});

describe("ChatPanel history", () => {
    function conversationOf(id: string, messages: StoredMessage[]): StoredConversation {
        return {
            id,
            title: messages[0].text,
            createdAt: messages[0].time,
            updatedAt: messages[messages.length - 1].time,
            messages,
        };
    }

    const userMessage = (text: string, time: number): StoredMessage => ({ role: "user", text, time });

    const assistantMessage = (text: string, time: number, toolName: string): StoredMessage => ({
        role: "assistant",
        text,
        time,
        workedMs: 3000,
        tools: [{ name: toolName, args: "{}", result: JSON.stringify({ created: [{ name: "Box" }] }) }],
    });

    /** A document that already carries the given conversations as its history. */
    function documentWith(id: string, ...conversations: StoredConversation[]): IDocument {
        const document = createMockDocument({ id });
        writeConversations(document, conversations);
        return document;
    }

    function panelOn(document: IDocument): ChatPanel {
        const panel = new ChatPanel();
        (panel as any).openDocument(document);
        return panel;
    }

    function historyOn(document: IDocument): StoredConversation[] {
        return readConversations(document);
    }

    function historyItems(panel: ChatPanel): NodeListOf<HTMLElement> {
        return (panel as any).historyListEl.querySelectorAll(".historyItem");
    }

    test("archives a finished turn into the document that hosted it", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = panelOn(document);

        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("Made a box.");
        });
        (panel as any).input.value = "make a box";
        await (panel as any).send();

        const saved = historyOn(document);
        expect(saved.length).toBe(1);
        expect(saved[0].title).toBe("make a box");
        expect(saved[0].messages.map((m) => `${m.role}:${m.text}`)).toEqual([
            "user:make a box",
            "assistant:Made a box.",
        ]);
    });

    test("restores the transcript and a context the model can resume from", () => {
        const document = documentWith(
            "d1",
            conversationOf("c1", [
                userMessage("make a box", 1),
                assistantMessage("Made a box.", 2, "run_program"),
            ]),
        );

        const panel = panelOn(document);

        expect(panel.querySelector(".user")?.textContent).toBe("make a box");
        expect(panel.querySelector(".markdown")?.textContent?.trim()).toBe("Made a box.");
        expect(panel.querySelector(".toolCard .toolName")?.textContent).toBe("run_program");
        // A restored turn reads like any finished one: collapsed work block, footer included
        expect(panel.querySelector(".workBlock")?.classList.contains("open")).toBe(false);
        expect(panel.querySelector(".msgFooter")).not.toBeNull();

        // The model resumes from text and images only — no thinking, no tool exchange
        expect((panel as any).messages).toEqual([
            { role: "user", content: "make a box", images: undefined },
            { role: "assistant", content: "Made a box." },
        ]);
    });

    test("keeps each restored turn's tool cards in their own work block", () => {
        const document = documentWith(
            "d1",
            conversationOf("c1", [
                userMessage("first", 1),
                assistantMessage("one", 2, "tool_a"),
                userMessage("second", 3),
                assistantMessage("two", 4, "tool_b"),
            ]),
        );

        const panel = panelOn(document);

        const blocks = panel.querySelectorAll(".workBlock");
        expect(blocks.length).toBe(2);
        expect(blocks[0].querySelector(".toolName")?.textContent).toBe("tool_a");
        expect(blocks[1].querySelector(".toolName")?.textContent).toBe("tool_b");
    });

    test("keeps the original footer time when a turn is restored", () => {
        const time = new Date(2026, 0, 2, 9, 30).getTime();
        const document = documentWith(
            "d1",
            conversationOf("c1", [userMessage("hi", time), assistantMessage("hey", time, "t")]),
        );

        const panel = panelOn(document);

        expect(panel.querySelector(".msgTime")?.textContent).toBe(
            new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        );
    });

    test("starting a new chat archives the old one and clears the transcript", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = panelOn(document);
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("ok");
        });
        (panel as any).input.value = "make a box";
        await (panel as any).send();

        (panel as any).startNewConversation();

        expect((panel as any).messages.length).toBe(0);
        expect((panel as any).conversation.messages.length).toBe(0);
        expect(panel.querySelector(".user")).toBeNull();
        expect(historyOn(document).length).toBe(1);
    });

    test("lists the document's conversations newest first and marks the open one", () => {
        const document = documentWith(
            "d1",
            conversationOf("c1", [userMessage("the older chat", 1)]),
            conversationOf("c2", [userMessage("the newer chat", 9)]),
        );

        const panel = panelOn(document);
        (panel as any).showHistory();

        const items = historyItems(panel);
        expect(items.length).toBe(2);
        expect(items[0].querySelector(".historyItemTitle")?.textContent).toBe("the newer chat");
        expect(items[0].classList.contains("historyItemActive")).toBe(true);
        expect(items[1].classList.contains("historyItemActive")).toBe(false);
    });

    test("switches to the conversation picked from the list", () => {
        const document = documentWith(
            "d1",
            conversationOf("c1", [userMessage("the older chat", 1)]),
            conversationOf("c2", [userMessage("the newer chat", 9)]),
        );

        const panel = panelOn(document);
        expect(panel.querySelector(".user")?.textContent).toBe("the newer chat");

        (panel as any).showHistory();
        historyItems(panel)[1].click();

        expect(panel.querySelector(".user")?.textContent).toBe("the older chat");
        expect((panel as any).historyOverlay.style.display).toBe("none");
    });

    test("deletes a conversation only after the user confirms", () => {
        const document = documentWith(
            "d1",
            conversationOf("c1", [userMessage("keep me", 1)]),
            conversationOf("c2", [userMessage("delete me", 9)]),
        );
        const panel = panelOn(document);
        (panel as any).showHistory();

        try {
            rs.stubGlobal(
                "confirm",
                rs.fn(() => false),
            );
            historyItems(panel)[0].querySelector<HTMLButtonElement>(".historyItemDelete")!.click();
            expect(historyOn(document).length).toBe(2);

            rs.stubGlobal(
                "confirm",
                rs.fn(() => true),
            );
            historyItems(panel)[0].querySelector<HTMLButtonElement>(".historyItemDelete")!.click();

            expect(historyOn(document).map((c) => c.id)).toEqual(["c1"]);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("titles a conversation whose first message carried no text as untitled", () => {
        const document = documentWith("d1", conversationOf("c1", [userMessage("", 1)]));

        const panel = panelOn(document);
        (panel as any).showHistory();

        expect(historyItems(panel)[0].querySelector(".historyItemTitle")?.textContent).toBe("ai.untitled");
    });

    test("follows the active document", () => {
        const documentOne = documentWith("d1", conversationOf("c1", [userMessage("doc one chat", 1)]));
        const documentTwo = documentWith("d2", conversationOf("c2", [userMessage("doc two chat", 2)]));
        const panel = panelOn(documentOne);
        expect(panel.querySelector(".user")?.textContent).toBe("doc one chat");

        PubSub.default.pub("activeViewChanged", { document: documentTwo } as any);

        expect(panel.querySelector(".user")?.textContent).toBe("doc two chat");
    });
});

describe("ChatPanel questions", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    function panelOn(document: IDocument): ChatPanel {
        const panel = new ChatPanel();
        (panel as any).openDocument(document);
        return panel;
    }

    /** Stands in for the agent: calls the real ask_user tool, then reports the call like agent.ts does. */
    function answerWith(question: AskRequest) {
        return async (opts: any) => {
            const tool = opts.tools.find((t: { name: string }) => t.name === "ask_user");
            // agent.ts passes the run's signal through; the abort test depends on it.
            const answer = String(await tool.handler(question, opts.signal));
            opts.callbacks.onToolCall({
                name: "ask_user",
                arguments: JSON.stringify(question),
                result: answer,
            });
            opts.callbacks.onTextDelta("done");
        };
    }

    function startAsk(panel: ChatPanel, question: AskRequest): Promise<void> {
        agentMock.runAgent.mockImplementationOnce(answerWith(question));
        (panel as any).input.value = "cut a hole";
        return (panel as any).send();
    }

    test("asks above the assistant reply and resumes with the clicked option", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());

        const sending = startAsk(panel, { question: "how big?", options: ["6mm", "8mm"] });
        await flush();

        const card = panel.querySelector(".askCard")!;
        expect(card.querySelector(".askQuestion")?.textContent).toBe("how big?");
        expect(card.querySelectorAll(".askOption").length).toBe(2);
        // The card belongs before the assistant bubble; appending it after would read backwards.
        const children = Array.from((panel as any).messageList.children) as Element[];
        const assistantAt = children.findIndex((c) => c.classList.contains("assistant"));
        expect(children.indexOf(card)).toBeLessThan(assistantAt);

        (card.querySelectorAll(".askOption")[1] as HTMLButtonElement).click();
        await sending;

        expect(card.classList.contains("askAnswered")).toBe(true);
        expect(card.querySelector(".askAnswer")?.textContent).toBe("8mm");
        // The handler drew this card, so onToolCall must not have drawn a second one for it
        expect(panel.querySelectorAll(".askCard").length).toBe(1);
        expect(panel.querySelector(".toolCard")).toBeNull();
        expect(panel.querySelector(".markdown")?.textContent).toContain("done");
    });

    test("takes a typed answer on Enter", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());

        const sending = startAsk(panel, { question: "how big?", options: ["6mm", "8mm"] });
        await flush();

        const card = panel.querySelector(".askCard")!;
        const input = card.querySelector(".askInput") as HTMLInputElement;
        input.value = "12.5mm";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
        await sending;

        expect(card.querySelector(".askAnswer")?.textContent).toBe("12.5mm");
    });

    test("stopping the run releases a question that is still waiting", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());

        const sending = startAsk(panel, { question: "how big?" });
        await flush();
        const card = panel.querySelector(".askCard")!;

        (panel as any).interrupt();
        await sending;

        expect((panel as any).sending).toBe(false);
        expect(card.querySelector(".askInputRow")).toBeNull();
        expect(card.querySelector(".askAnswer")?.textContent).toBe("ai.ask.notAnswered");
    });

    test("a new chat abandons the question without leaking the late reply", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = panelOn(document);

        let handedBack = "";
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            const tool = opts.tools.find((t: { name: string }) => t.name === "ask_user");
            handedBack = String(await tool.handler({ question: "how big?" }));
            opts.callbacks.onTextDelta("late reply");
        });
        (panel as any).input.value = "cut a hole";
        const sending: Promise<void> = (panel as any).send();
        await flush();
        expect(panel.querySelector(".askCard")).not.toBeNull();

        (panel as any).startNewConversation();
        await sending;

        // The model was told the question was dropped...
        expect(handedBack).toContain("interrupted");
        // ...and the reply that arrived afterwards belongs to no conversation at all
        expect(panel.querySelector(".askCard")).toBeNull();
        expect(panel.querySelector(".markdown")).toBeNull();
        const saved = readConversations(document);
        expect(saved.length).toBe(1);
        expect(saved[0].messages.map((m) => m.role)).toEqual(["user"]);
    });

    test("replays an answered question from the transcript", () => {
        const document = createMockDocument({ id: "d1" });
        writeConversations(document, [
            {
                id: "c1",
                title: "cut a hole",
                createdAt: 1,
                updatedAt: 2,
                messages: [
                    { role: "user", text: "cut a hole", time: 1 },
                    {
                        role: "assistant",
                        text: "Done.",
                        time: 2,
                        asks: [{ question: "how big?", options: ["6mm", "8mm"], answer: "8mm" }],
                    },
                ],
            },
        ]);

        const panel = panelOn(document);

        const card = panel.querySelector(".askCard");
        expect(card).not.toBeNull();
        expect(card!.classList.contains("askAnswered")).toBe(true);
        expect(card!.querySelector(".askQuestion")?.textContent).toBe("how big?");
        expect(card!.querySelector(".askAnswer")?.textContent).toBe("8mm");
    });
});
