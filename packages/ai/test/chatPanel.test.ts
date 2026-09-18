// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mockLocalStorage } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ChatPanel } from "../src/chatPanel";
import { loadConfig, saveConfig } from "../src/settings";

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
}));

describe("ChatPanel", () => {
    beforeEach(() => {
        mockLocalStorage();
        agentMock.pending.length = 0;
        agentMock.runAgent.mock.calls.length = 0;
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
        expect(actions).toEqual([anyPanel.settingsButtonEl, anyPanel.clearButtonEl, anyPanel.dockButtonEl]);

        // Simulate the host title bar taking over the actions, then docking back
        const host = document.createElement("div");
        host.append(...actions);
        expect(anyPanel.headerButtons.contains(anyPanel.settingsButtonEl)).toBe(false);

        panel.setFloating(false);
        expect(panel.header.style.display).toBe("");
        expect(anyPanel.headerButtons.contains(anyPanel.settingsButtonEl)).toBe(true);
        expect(anyPanel.headerButtons.contains(anyPanel.clearButtonEl)).toBe(true);
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
