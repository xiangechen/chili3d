// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type IHistoryRecord, PubSub } from "@chili3d/core";
import { createMockDocument, createPlainNode, mockLocalStorage } from "@chili3d/core/test-utils";
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
    msgFooter: "msgFooter",
    copyButton: "copyButton",
    copyIcon: "copyIcon",
    msgTime: "msgTime",
    msgWorked: "msgWorked",
    toolLink: "toolLink",
    contextNotice: "contextNotice",
    contextMeter: "contextMeter",
    contextBar: "contextBar",
    contextFill: "contextFill",
    contextText: "contextText",
    contextMeterFull: "contextMeterFull",
    userRow: "userRow",
    userUndo: "userUndo",
    userUndoIcon: "userUndoIcon",
    thinkingBlock: "thinkingBlock",
    thinkingHeader: "thinkingHeader",
    thinkingSummary: "thinkingSummary",
    thinkingChevron: "thinkingChevron",
    thinkingBody: "thinkingBody",
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
    askHeader: "askHeader",
    askStop: "askStop",
    askStopIcon: "askStopIcon",
    askAnswered: "askAnswered",
    askQuestion: "askQuestion",
    askOptions: "askOptions",
    askOption: "askOption",
    askInputRow: "askInputRow",
    askInput: "askInput",
    askAnswer: "askAnswer",
}));

// File-level, not per-describe: the panels share localStorage, PubSub and the ask handler, and a
// suite that left any of them dirty would leak into whichever suite ran next.
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

/**
 * Let the panel's frame-batched draw land. Streamed text is drawn once per animation frame rather
 * than once per delta, so a delta's own assertion has to wait a frame — as a reader would.
 */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/**
 * Stand in for the layout engine, which happy-dom does not have: `height` states how tall the
 * transcript is right now, and `scrollTop` clamps to the range that implies — as a browser does.
 * Without the clamp a scroll the panel asked for lands past the end, and the follow rule could not
 * be told from its absence the way it read in a real engine.
 */
function fakeGeometry(list: HTMLElement, height: () => number, clientHeight = 200) {
    let scrollTop = 0;
    const bottom = () => Math.max(0, height() - clientHeight);
    Object.defineProperties(list, {
        scrollTop: {
            get: () => scrollTop,
            set: (v: number) => {
                scrollTop = Math.min(Math.max(0, v), bottom());
            },
            configurable: true,
        },
        scrollHeight: { get: height, configurable: true },
        clientHeight: { value: clientHeight, configurable: true },
    });
    return { bottom };
}

describe("ChatPanel", () => {
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

    test("trims history to fit the window, keeping the newest turns", () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 400 });
        const panel = new ChatPanel();
        const messages = (panel as any).messages as any[];
        for (let i = 0; i < 45; i++) {
            messages.push({
                role: "user",
                // 40 characters — about 10 tokens each, so 45 of them overflow a 400-token window.
                content: `m${i}`.padEnd(40, "x"),
                // Empty data so the arithmetic below is about the text budget alone.
                images: i % 10 === 0 ? [{ mediaType: "image/png", data: "" }] : undefined,
            });
        }

        (panel as any).trimMessages();

        // 45 x 10 tokens against a 400-token window at 80%: the oldest 13 go, the newest 32 stay.
        expect(messages.length).toBe(32);
        expect(messages[0].content.startsWith("m13")).toBe(true);
        expect(messages.at(-1)!.content.startsWith("m44")).toBe(true);
        // Only the latest screenshot survives, whatever the budget: base64 dwarfs everything else.
        const withImages = messages.filter((m) => m.images);
        expect(withImages.length).toBe(1);
        expect(withImages[0].content.startsWith("m40")).toBe(true);
    });

    test("trim cuts at a user boundary so tool_use/tool_result pairs stay intact", () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 400 });
        const panel = new ChatPanel();
        const messages = (panel as any).messages as any[];
        // An oversized opening turn: dropping it must take its tools with it, not leave them
        // dangling in front of the window.
        messages.push({ role: "user", content: "old".padEnd(400, "x") });
        messages.push({
            role: "assistant",
            content: "",
            toolCalls: [{ id: "t1", name: "x", arguments: "{}" }],
        });
        messages.push({ role: "tool", toolCallId: "t1", name: "x", content: "{}" });
        for (let i = 0; i < 38; i++) messages.push({ role: "user", content: `m${i}`.padEnd(40, "x") });

        (panel as any).trimMessages();

        expect(messages.every((m) => m.role === "user")).toBe(true);
        expect(messages[0].content.startsWith("m")).toBe(true);
        expect(messages.length).toBeLessThan(39);
    });

    test("keeps the newest message even when it alone overruns the window", () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 100 });
        const panel = new ChatPanel();
        const messages = (panel as any).messages as any[];
        messages.push({ role: "user", content: "short" });
        messages.push({ role: "user", content: "x".repeat(4000) });

        (panel as any).trimMessages();

        // An empty context answers nothing, so the oversized message goes through on its own.
        expect(messages.length).toBe(1);
        expect(messages[0].content).toBe("x".repeat(4000));
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

    test("keeps the waiting dots below the turn while the agent is still running", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );

        const anyPanel = panel as any;
        anyPanel.input.value = "make a box";
        const sending = anyPanel.send();

        callbacks.onToolCall({ name: "screenshot", arguments: "{}", result: "{}" });
        callbacks.onTextDelta("drawing");

        // The dots used to live inside the collapsible work row; with the cards flat they are the
        // only thing left telling the user the run has not finished.
        const turn = panel.querySelector(".assistant")!;
        expect(turn.querySelectorAll(".toolCard").length).toBe(1);
        expect(turn.lastElementChild!.className).toBe("thinkingDots");

        agentMock.pending.shift()!.resolve();
        await sending;

        // The footer takes over once the turn ends.
        expect(turn.querySelector(".thinkingDots")).toBeNull();
        expect(turn.querySelector(".msgFooter")).not.toBeNull();
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

    test("marks the top of the transcript once history outgrows the context", () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 200 });
        const panel = new ChatPanel();
        const messages = (panel as any).messages as any[];
        for (let i = 0; i < 45; i++) messages.push({ role: "user", content: `m${i}`.padEnd(40, "x") });

        expect(panel.querySelector(".contextNotice")).toBeNull();

        (panel as any).trimMessages();

        const notice = panel.querySelector(".contextNotice");
        expect(notice).not.toBeNull();
        // Above everything, because everything above it is what the model no longer gets.
        expect((panel as any).messageList.firstElementChild).toBe(notice);

        (panel as any).trimMessages();
        expect(panel.querySelectorAll(".contextNotice").length).toBe(1);
    });

    test("shows reasoning while it streams and folds it away once the reply starts", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );

        const anyPanel = panel as any;
        anyPanel.input.value = "make a box";
        const sending = anyPanel.send();

        callbacks.onThinkingDelta("the user wants ");
        callbacks.onThinkingDelta("a box");

        const block = panel.querySelector(".thinkingBlock")!;
        // Open while it streams: watching it work is the whole point of showing it.
        expect(block.classList.contains("open")).toBe(true);
        expect(block.querySelector(".thinkingBody")!.textContent).toBe("the user wants a box");

        callbacks.onTextDelta("Making it");
        await nextFrame();

        expect(block.classList.contains("open")).toBe(false);
        expect(block.querySelector(".thinkingSummary")!.textContent).toBe("ai.thoughtFor");
        // The reply follows the reasoning it came out of.
        expect(panel.querySelector(".markdown")!.textContent?.trim()).toBe("Making it");

        agentMock.pending.shift()!.resolve();
        await sending;
    });

    test("holds only the tail of a long train of thought while it streams, all of it once folded", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = new ChatPanel();
        (panel as any).openDocument(document);
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );

        (panel as any).input.value = "make a box";
        const sending = (panel as any).send();

        // 120 x 400 characters — well past the 32k the streaming block holds.
        const chunk = "推理".repeat(200);
        for (let i = 0; i < 120; i++) callbacks.onThinkingDelta(chunk);

        // What the block holds is the tail of it: the box is a fixed-height window, and dropping
        // the head is what keeps the frame drawing into it from laying out the whole train.
        const body = panel.querySelector(".thinkingBody") as HTMLElement;
        expect(body.textContent!.length).toBeLessThan(chunk.length * 120);
        expect(body.textContent!.endsWith(chunk)).toBe(true);

        callbacks.onTextDelta("done");
        agentMock.pending.shift()!.resolve();
        await sending;

        // Folded, it holds the whole of it again: hidden, the block lays out none of it, and a
        // reader who expands it reads what a reopened conversation would replay.
        expect(body.textContent!.length).toBe(chunk.length * 120);
        expect(readConversations(document)[0].messages[1].parts).toEqual([
            { type: "thinking", text: chunk.repeat(120), ms: expect.any(Number) },
            { type: "text", text: "done" },
        ]);
    });

    test("carries the reader down the reasoning box only while they are at its end", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );

        anyPanel.input.value = "make a box";
        const sending = anyPanel.send();
        callbacks.onThinkingDelta("weighing it up");
        await nextFrame();

        // happy-dom reports 0 for every scroll metric, which reads as "at the end" — so the box's
        // geometry is stated outright, as the transcript's is in the follow tests.
        const body = panel.querySelector(".thinkingBody") as HTMLElement;
        Object.defineProperties(body, {
            scrollTop: { value: 0, writable: true, configurable: true },
            scrollHeight: { value: 900, configurable: true },
            clientHeight: { value: 240, configurable: true },
        });

        // Scrolled up inside the box, where the transcript's own follow says nothing: the newest
        // reasoning must not drag them back down under it.
        body.scrollTop = 300;
        body.dispatchEvent(new Event("scroll"));
        callbacks.onThinkingDelta("still weighing");
        await nextFrame();
        expect(body.scrollTop).toBe(300);

        // Back at its end — 900 - 240 = 660 — so the rest arrives under their eyes again.
        body.scrollTop = 660;
        body.dispatchEvent(new Event("scroll"));
        callbacks.onThinkingDelta(" done");
        await nextFrame();
        expect(body.scrollTop).toBe(900);

        agentMock.pending.shift()!.resolve();
        await sending;
    });

    test("reveals the nodes a card names when its summary is clicked", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const box = createPlainNode("Box", "node-1");
        const selected: string[][] = [];
        const fitContent = rs.fn(() => {});
        const document = createMockDocument({
            application: { activeView: { cameraController: { fitContent } } } as any,
            selection: {
                setSelectedNodes: (nodes) => {
                    selected.push(nodes.map((n) => n.id));
                    return nodes.length;
                },
            },
            modelManager: { findNodes: (fn) => (fn?.(box) ? [box] : []) },
        });

        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({
                name: "run_program",
                arguments: "{}",
                result: JSON.stringify({ created: [{ nodeId: "node-1", name: "Box" }] }),
            });
        });
        const panel = new ChatPanel();
        (panel as any).openDocument(document);
        (panel as any).input.value = "make a box";
        await (panel as any).send();

        const link = panel.querySelector(".toolLink") as HTMLElement;
        expect(link.textContent).toBe("ai.tool.created");
        link.click();

        // One click from "it made a box" to the box being selected and framed.
        expect(selected).toEqual([["node-1"]]);
        expect(fitContent).toHaveBeenCalledTimes(1);
    });

    test("leaves removed nodes unclickable, since they no longer exist", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({
                name: "run_program",
                arguments: "{}",
                result: JSON.stringify({ removed: [{ nodeId: "gone", name: "Tool" }] }),
            });
        });
        const panel = new ChatPanel();
        (panel as any).input.value = "cut";
        await (panel as any).send();

        expect(panel.querySelector(".toolResult")!.textContent).toBe("ai.tool.removed");
        expect(panel.querySelector(".toolLink")).toBeNull();
    });

    test("interleaves paragraphs and tool cards in the order they streamed", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("Looking");
            opts.callbacks.onToolCall({ name: "screenshot", arguments: "{}", result: "{}" });
            opts.callbacks.onTextDelta("Drawing");
            opts.callbacks.onToolCall({ name: "run_program", arguments: "{}", result: "{}" });
            opts.callbacks.onTextDelta("Done");
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "make a box";
        await anyPanel.send();

        // Each paragraph is its own block: without splitting, every tool would sort above every
        // word of the reply and the turn would read backwards.
        const assistantEl = panel.querySelector(".assistant")!;
        const blocks = Array.from(assistantEl.children);
        expect(blocks.map((b) => b.className.split(" ")[0])).toEqual([
            "markdown",
            "toolCard",
            "markdown",
            "toolCard",
            "markdown",
            "msgFooter",
        ]);
        const [first, , second, , third] = blocks;
        expect(first.textContent?.trim()).toBe("Looking");
        expect(second.textContent?.trim()).toBe("Drawing");
        expect(third.textContent?.trim()).toBe("Done");
        expect(blocks[1].querySelector(".toolName")?.textContent).toBe("screenshot");
        expect(blocks[3].querySelector(".toolName")?.textContent).toBe("run_program");
    });

    test("carries the reader along only while they are at the bottom", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );

        anyPanel.input.value = "make a box";
        const sending = anyPanel.send();
        const list = anyPanel.messageList as HTMLElement;
        // happy-dom reports 0 for every scroll metric, which reads as "at the bottom" — so the
        // geometry is stated outright, or the follow rule could not be told from its absence.
        const scrollTo = (scrollTop: number) => {
            Object.defineProperties(list, {
                scrollTop: { value: scrollTop, writable: true, configurable: true },
                scrollHeight: { value: 1000, configurable: true },
                clientHeight: { value: 200, configurable: true },
            });
            // The panel reads the reader's position off the scrolling they do, so a test that only
            // writes the number in has to fire the event a real drag would.
            list.dispatchEvent(new Event("scroll"));
        };

        // Scrolled up into the middle of what is already there: the reply must not drag the
        // reader back down under it.
        scrollTo(300);
        callbacks.onTextDelta("still working");
        await nextFrame();
        expect(list.scrollTop).toBe(300);

        callbacks.onToolCall({ name: "screenshot", arguments: "{}", result: "{}" });
        expect(list.scrollTop).toBe(300);

        // Back at the bottom — 1000 - 200 = 800, inside the follow slack — so the rest arrives
        // under the reader's eyes again.
        scrollTo(800);
        callbacks.onTextDelta(" done");
        await nextFrame();
        expect(list.scrollTop).toBe(1000);

        agentMock.pending.shift()!.resolve();
        await sending;
    });

    test("a tool card landing does not leave a following reader behind", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );
        const list = anyPanel.messageList as HTMLElement;
        // A layout that grows with the transcript, the way a real one does: every element the turn
        // draws adds height, and the card is several of them landing at once — more than the slack
        // can absorb, under a reader who has not moved.
        const { bottom } = fakeGeometry(list, () => 200 + list.querySelectorAll("*").length * 20);

        anyPanel.input.value = "make a box";
        const sending = anyPanel.send();
        callbacks.onTextDelta("working");
        await nextFrame();
        expect(list.scrollTop).toBe(bottom());

        callbacks.onToolCall({ name: "create_box", arguments: "{}", result: "{}" });

        expect(list.scrollTop).toBe(bottom());
        agentMock.pending.shift()!.resolve();
        await sending;
    });

    test("draws a frame's worth of streamed text in one go, not once per delta", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );
        // Counting the scroll writes stands in for counting the draws: every draw ends by carrying
        // the reader down, and each of those measurements is what a delta used to cost.
        const list = anyPanel.messageList as HTMLElement;
        let scrolls = 0;
        Object.defineProperties(list, {
            scrollTop: { get: () => 0, set: () => scrolls++, configurable: true },
            scrollHeight: { get: () => 1000, configurable: true },
            clientHeight: { value: 200, configurable: true },
        });

        anyPanel.input.value = "make a box";
        const sending = anyPanel.send();
        callbacks.onTextDelta("开场");
        await nextFrame();
        const drawn = scrolls;

        // A hundred tokens inside one frame: the paragraph they were added to is not redrawn and
        // the transcript is not measured against it until the frame that closes them. Redrawing per
        // delta made a long answer quadratic, and every one of those redraws measured a transcript
        // that a long conversation had already made dear.
        const tokens = Array.from({ length: 100 }, (_, i) => `第${i}段 `);
        for (const token of tokens) callbacks.onTextDelta(token);

        const markdown = panel.querySelector(".markdown") as HTMLElement;
        expect(markdown.textContent?.trim()).toBe("开场");
        expect(scrolls).toBe(drawn);

        await nextFrame();
        expect(markdown.textContent?.trim()).toBe(`开场${tokens.join("")}`.trim());
        expect(scrolls).toBe(drawn + 1);

        agentMock.pending.shift()!.resolve();
        await sending;
    });

    test("an attachment that decodes late is carried past rather than left below the fold", async () => {
        let decoded = false;
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        agentMock.runAgent.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    agentMock.pending.push({ resolve });
                }),
        );
        const list = anyPanel.messageList as HTMLElement;
        // The bubble is laid out empty and only takes its height when the bytes have decoded, which
        // is a frame or more after the transcript was scrolled to make room for it.
        const { bottom } = fakeGeometry(list, () => (decoded ? 1060 : 1000));

        anyPanel.pendingImages.push({ mediaType: "image/png", data: "abc" });
        anyPanel.input.value = "what is this?";
        const sending = anyPanel.send();
        const image = list.querySelector("img");
        expect(image).not.toBeNull();
        expect(list.scrollTop).toBe(bottom());

        decoded = true;
        image!.dispatchEvent(new Event("load"));

        expect(list.scrollTop).toBe(bottom());
        agentMock.pending.shift()!.resolve();
        await sending;
    });

    test("reports the elapsed time in the footer of a turn that called tools", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onToolCall({ name: "run_program", arguments: "{}", result: "{}" });
        });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        anyPanel.input.value = "make a box";
        await anyPanel.send();

        // A tool-only turn has no reply to carry a footer, but the elapsed time still needs a home.
        const footer = panel.querySelector(".assistant .msgFooter");
        expect(footer).not.toBeNull();
        expect(footer!.querySelector(".msgWorked")!.textContent).toBe("ai.workedFor");
        expect(panel.querySelector(".noReply")).not.toBeNull();
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
        // The shown icon is the `<use>` href — the svg's own attributes are set once and never
        // rewritten, so `getAttribute("icon")` would sit at the initial value however it looks.
        const iconHref = () =>
            (anyPanel.sendIconEl as SVGSVGElement)
                .querySelector("use")
                ?.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        expect(iconHref()).toBe("#icon-square");
        expect(sendButton.disabled).toBe(false);
        expect(sendButton.classList.contains("stopButton")).toBe(true);

        sendButton.click();
        await pending;

        expect(anyPanel.sending).toBe(false);
        expect(anyPanel.abortController).toBeUndefined();
        expect(iconHref()).toBe("#icon-up");
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
        anyPanel.contextWindowSelect.value = "256000";
        (overlay.querySelector("form") as HTMLFormElement).requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(overlay.style.display).toBe("none");
        expect(loadConfig()?.apiKey).toBe("sk-test");
        expect(loadConfig()?.contextWindow).toBe(256000);
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

    test("settings overlay carries the panel's own close button", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        const onClose = rs.fn(() => {});
        panel.onClose = onClose;

        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        const overlay = panel.querySelector(".settingsOverlay") as HTMLElement;
        const buttons = overlay.querySelectorAll<HTMLButtonElement>(".settingsHeader .iconButton");
        // Back, then close: the overlay covers the panel header, so it owes the user that exit.
        expect(buttons.length).toBe(2);

        buttons[1].click();

        expect(onClose).toHaveBeenCalledTimes(1);
        // Closing the panel is not leaving the overlay — that stays the back button's job.
        expect(overlay.style.display).toBe("flex");
    });

    test("offers the context window as the tiers models actually ship at", () => {
        const panel = new ChatPanel();
        const select = (panel as any).contextWindowSelect as HTMLSelectElement;

        expect(Array.from(select.options).map((o) => o.value)).toEqual([
            "200000",
            "256000",
            "400000",
            "512000",
            "1000000",
        ]);
        expect(select.options[0].textContent).toBe("200k");
        // 1M must not read as "1000k".
        expect(select.options[4].textContent).toBe("1M");
    });

    test("keeps a window size that is not one of the tiers", async () => {
        // A value typed in while this was still a number field.
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 300000 });
        const panel = new ChatPanel();
        const anyPanel = panel as any;

        (anyPanel.settingsButtonEl as HTMLButtonElement).click();

        // It has to show, not blank out — a blank select saves the default and loses the value.
        expect(anyPanel.contextWindowSelect.value).toBe("300000");
        expect(anyPanel.contextWindowSelect.selectedOptions[0].textContent).toBe("300k");

        (panel.querySelector(".settingsOverlay form") as HTMLFormElement).requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(loadConfig()?.contextWindow).toBe(300000);
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

    test("a provider switch adopts the preset values the fields still hold", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        // Nothing saved: the fields start as the anthropic preset's.
        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        expect(anyPanel.modelInput.value).toBe("claude-opus-5");

        const switchTo = (id: string) => {
            anyPanel.providerSelect.value = id;
            anyPanel.providerSelect.onchange?.(new Event("change"));
        };

        switchTo("openai");
        expect(anyPanel.baseURLInput.value).toBe("https://api.openai.com/v1");
        expect(anyPanel.modelInput.value).toBe("gpt-5.5");

        // And back: the field now holds openai's URL, which is still the preset's to change —
        // the switch has to know where the value came from, not just that it is non-empty.
        switchTo("anthropic");
        expect(anyPanel.baseURLInput.value).toBe("https://api.anthropic.com");
        expect(anyPanel.modelInput.value).toBe("claude-opus-5");
    });

    test("keeps the base URL and model the user has made their own", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        anyPanel.baseURLInput.value = "https://my-proxy.example/v1";
        anyPanel.modelInput.value = "gpt-5.5-codex";

        anyPanel.providerSelect.value = "responses";
        anyPanel.providerSelect.onchange?.(new Event("change"));

        // A switch is a routing choice, not a reset: what the user typed survives it, field by
        // field — the base URL is theirs, while the model still only carries an edited value here.
        expect(anyPanel.baseURLInput.value).toBe("https://my-proxy.example/v1");
        expect(anyPanel.modelInput.value).toBe("gpt-5.5-codex");

        // The window is a setting of the user's too, and a provider switch has no business
        // resetting it to the default behind their back.
        anyPanel.contextWindowSelect.value = "200000";
        anyPanel.providerSelect.value = "anthropic";
        anyPanel.providerSelect.onchange?.(new Event("change"));
        expect(anyPanel.contextWindowSelect.value).toBe("200000");
    });

    test("follows the preset in the field the user did not change", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        anyPanel.modelInput.value = "my-model";

        anyPanel.providerSelect.value = "responses";
        anyPanel.providerSelect.onchange?.(new Event("change"));

        // Per field, not per form: the base URL still holds anthropic's, so the preset re-points
        // it; the model is the user's and stays.
        expect(anyPanel.baseURLInput.value).toBe("https://api.openai.com/v1");
        expect(anyPanel.modelInput.value).toBe("my-model");
    });

    test("fills a field the user has emptied when the provider changes", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        (anyPanel.settingsButtonEl as HTMLButtonElement).click();
        anyPanel.modelInput.value = "";

        anyPanel.providerSelect.value = "responses";
        anyPanel.providerSelect.onchange?.(new Event("change"));

        // Empty says nothing worth keeping, so the preset has it — unlike a value that was typed
        // and then changed to another, which stays the user's.
        expect(anyPanel.modelInput.value).toBe("gpt-5.5");
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

    test("archives a turn's parts in the order they streamed", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = panelOn(document);

        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("Looking");
            opts.callbacks.onToolCall({ name: "screenshot", arguments: "{}", result: "{}" });
            opts.callbacks.onTextDelta("Drawn");
        });
        (panel as any).input.value = "draw";
        await (panel as any).send();

        const saved = historyOn(document);
        expect(saved[0].messages[1].parts).toEqual([
            { type: "text", text: "Looking" },
            { type: "tool", name: "screenshot", args: "{}", result: "{}" },
            { type: "text", text: "Drawn" },
        ]);
        // `text` stays the paragraphs concatenated: the copy button and the model context read it
        expect(saved[0].messages[1].text).toBe("LookingDrawn");
    });

    test("keeps the paragraphs a turn had already sealed when it errors mid-way", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = panelOn(document);

        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onTextDelta("Looking");
            opts.callbacks.onToolCall({ name: "screenshot", arguments: "{}", result: "{}" });
            opts.callbacks.onTextDelta("half a sen");
            throw new Error("connection lost");
        });
        (panel as any).input.value = "draw";
        await (panel as any).send();

        // The half-written paragraph goes; the sealed one stays, on screen and in the record. A
        // `text` tallied off the raw stream would have dropped it along with the discarded tail,
        // leaving a copy button that copies nothing over paragraphs the user can see.
        const saved = historyOn(document)[0].messages[1];
        expect(saved.parts).toEqual([
            { type: "text", text: "Looking" },
            { type: "tool", name: "screenshot", args: "{}", result: "{}" },
        ]);
        expect(saved.text).toBe("Looking");
        expect(panel.querySelector(".markdown")?.textContent?.trim()).toBe("Looking");
    });

    test("reverts the document, the transcript and the model to before a turn", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const undoStack: IHistoryRecord[] = [];
        const document = createMockDocument({
            history: {
                // A real stack, not a counter: the revert walks back to the record that was on top
                // when the turn began, so the mock has to have records to compare against.
                undoCount: () => undoStack.length,
                undoTop: () => undoStack[undoStack.length - 1],
                undo: () => {
                    undoStack.pop();
                },
            },
        });
        // Every turn leaves one transaction behind.
        agentMock.runAgent.mockImplementation(async (opts: any) => {
            undoStack.push({ name: `turn ${undoStack.length}` } as IHistoryRecord);
            opts.callbacks.onTextDelta("ok");
        });
        const panel = panelOn(document);
        const anyPanel = panel as any;

        anyPanel.input.value = "first";
        await anyPanel.send();
        anyPanel.input.value = "second";
        await anyPanel.send();
        expect(undoStack.length).toBe(2);

        // Reaching an older turn means the newer one goes with it — one document stack, and a
        // model that must not be left answering a question that is no longer on screen.
        (panel.querySelectorAll(".userUndo")[0] as HTMLButtonElement).click();

        expect(undoStack.length).toBe(0);
        expect(anyPanel.input.value).toBe("first");
        expect(panel.querySelectorAll(".userRow").length).toBe(0);
        expect(panel.querySelectorAll(".assistant").length).toBe(0);
        expect(anyPanel.messages.length).toBe(0);
        expect(readConversations(document)[0].messages.length).toBe(0);
    });

    test("reverts a turn whose mark has been evicted from a full undo stack", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        // The stack sitting at its cap: every `add` shifts the oldest record out, so `undoCount`
        // reports the same number however much a turn does. Only the top of the stack moves.
        const stack: IHistoryRecord[] = [];
        const limit = 3;
        const push = (name: string) => {
            stack.push({ name, undo: () => {}, redo: () => {}, dispose: () => {} });
            if (stack.length > limit) stack.shift()?.dispose();
        };
        for (let i = 0; i < limit; i++) push(`older ${i}`);

        const document = createMockDocument({
            history: {
                undoLimits: limit,
                undoCount: () => stack.length,
                undoTop: () => stack[stack.length - 1],
                undo: () => {
                    stack.pop();
                },
            },
        });
        agentMock.runAgent.mockImplementation(async (opts: any) => {
            push("from the turn");
            opts.callbacks.onTextDelta("ok");
        });
        const panel = panelOn(document);
        const anyPanel = panel as any;

        anyPanel.input.value = "make a box";
        await anyPanel.send();
        expect(stack.length).toBe(limit);

        (panel.querySelector(".userUndo") as HTMLButtonElement).click();

        // The turn's own record went with it, and the transcript went with the record. Without the
        // top of the stack to rewind to, a count would have read "nothing to do" and left the
        // document holding the shape the model made.
        expect(stack.map((r) => r.name)).toEqual(["older 1", "older 2"]);
        expect(panel.querySelectorAll(".userRow").length).toBe(0);
        expect(anyPanel.messages.length).toBe(0);
        expect(readConversations(document)[0].messages.length).toBe(0);
    });

    test("recomputes the context reading when a turn is taken back", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 1_000_000 });
        const document = createMockDocument({ history: { undoCount: () => 0, undo: () => {} } });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onUsage({
                inputTokens: 500_000,
                outputTokens: 10,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
            });
            opts.callbacks.onTextDelta("ok");
        });
        const panel = panelOn(document);
        const anyPanel = panel as any;

        anyPanel.input.value = "x".repeat(400);
        await anyPanel.send();
        expect(panel.querySelector(".contextText")!.textContent).toBe("500k / 1M");

        // The window shrank with the transcript; leaving 500k on screen would point the user at a
        // context that is not there any more.
        (panel.querySelector(".userUndo") as HTMLButtonElement).click();

        expect(panel.querySelector(".contextText")!.textContent).toBe("0 / 1M");
        expect((panel.querySelector(".contextFill") as HTMLElement).style.width).toBe("0.0%");
    });

    test("cuts a run loose when the turn it belongs to is taken back", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((resolve) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve });
                }),
        );

        (panel as any).input.value = "make a box";
        const sending = (panel as any).send();
        callbacks.onTextDelta("working");

        // Reverting mid-run: the run has to stop, or it writes its tail into what just went away.
        (panel.querySelector(".userUndo") as HTMLButtonElement).click();
        agentMock.pending.shift()!.resolve();
        await sending;

        expect((panel as any).sending).toBe(false);
        expect(panel.querySelector(".assistant")).toBeNull();
        expect((panel as any).messages.length).toBe(0);
    });

    test("leaves no turn behind when a run stopped mid-reasoning fails", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument();
        const panel = panelOn(document);
        let callbacks: any;
        agentMock.runAgent.mockImplementationOnce(
            (opts: any) =>
                new Promise<void>((_resolve, reject) => {
                    callbacks = opts.callbacks;
                    agentMock.pending.push({ resolve: () => reject(new Error("aborted")) });
                }),
        );

        (panel as any).input.value = "make a box";
        const sending = (panel as any).send();
        callbacks.onThinkingDelta("weighing it up");
        expect(panel.querySelector(".thinkingBlock")).not.toBeNull();

        (panel as any).interrupt();
        agentMock.pending.shift()!.resolve();
        await sending;

        // Reasoning and nothing after it is not an answer: the bubble it streamed into goes with
        // the run, and the record has to go with the bubble. Reasoning kept on its own would come
        // back as a turn the user never saw, whenever the conversation was reopened.
        expect(panel.querySelector(".assistant")).toBeNull();
        expect(historyOn(document)).toEqual([]);
    });

    test("gives back what the message carried, images included", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const document = createMockDocument({
            history: { undoCount: () => 0, undo: () => {} },
        });
        agentMock.runAgent.mockImplementationOnce(async () => {});
        const panel = panelOn(document);
        const anyPanel = panel as any;
        const image = { mediaType: "image/png", data: "abc" };

        anyPanel.pendingImages.push(image);
        anyPanel.input.value = "cut this out";
        await anyPanel.send();
        // Sending empties the tray, so the revert is what has to put it back.
        expect(anyPanel.pendingImages.length).toBe(0);

        (panel.querySelector(".userUndo") as HTMLButtonElement).click();

        expect(anyPanel.input.value).toBe("cut this out");
        expect(anyPanel.pendingImages).toEqual([image]);
        expect(panel.querySelector(".imageThumb")).not.toBeNull();
    });

    test("offers no revert control for turns restored from the archive", () => {
        const document = documentWith("d1", conversationOf("c1", [userMessage("hi", 1)]));
        const panel = panelOn(document);

        // Nothing in this session's stack corresponds to a turn that was merely read back.
        expect(panel.querySelector(".user")).not.toBeNull();
        expect(panel.querySelector(".userUndo")).toBeNull();
    });

    test("meters how full the context is, in the send row", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m", contextWindow: 100_000 });
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            opts.callbacks.onUsage({
                inputTokens: 1000,
                outputTokens: 500,
                cacheReadTokens: 8000,
                cacheCreationTokens: 500,
            });
            opts.callbacks.onTextDelta("ok");
        });
        const document = createMockDocument();
        const panel = panelOn(document);
        const meter = panel.querySelector(".contextMeter") as HTMLElement;
        // Nothing has been sent, so there is no reading to show.
        expect(meter.style.display).toBe("none");

        (panel as any).input.value = "make a box";
        await (panel as any).send();

        // 1000 + 8000 + 500 = 9.5k of the window: cached input still occupies the context, while
        // output is the reply, which only joins it next turn.
        expect(meter.style.display).toBe("");
        expect(panel.querySelector(".contextText")!.textContent).toBe("9.5k / 100k");
        expect((panel.querySelector(".contextFill") as HTMLElement).style.width).toBe("9.5%");

        // The reading goes into the message, or reopening the conversation would have nothing to
        // put back on the meter — the transcript alone cannot say how full the window was.
        expect(historyOn(document)[0].messages[1].usage).toEqual({
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 8000,
            cacheCreationTokens: 500,
        });

        (panel as any).startConversation();
        expect(meter.style.display).toBe("none");
        (panel as any).openConversation(historyOn(document)[0]);

        expect(meter.style.display).toBe("");
        expect(panel.querySelector(".contextText")!.textContent).toBe("9.5k / 100k");
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
        // A restored turn reads like any finished one: cards collapsed, footer included
        expect(panel.querySelector(".toolCard")?.classList.contains("open")).toBe(false);
        expect(panel.querySelector(".msgFooter")).not.toBeNull();

        // The model resumes from text and images only — no thinking, no tool exchange
        expect((panel as any).messages).toEqual([
            { role: "user", content: "make a box", images: undefined },
            { role: "assistant", content: "Made a box." },
        ]);
    });

    test("keeps each restored turn's tool cards inside that turn", () => {
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

        const turns = panel.querySelectorAll(".assistant");
        expect(turns.length).toBe(2);
        expect(turns[0].querySelector(".toolName")?.textContent).toBe("tool_a");
        expect(turns[1].querySelector(".toolName")?.textContent).toBe("tool_b");
    });

    test("restores a turn saved before parts as cards above the reply it belonged to", () => {
        const document = documentWith(
            "d1",
            conversationOf("c1", [userMessage("hi", 1), assistantMessage("Made a box.", 2, "run_program")]),
        );

        const panel = panelOn(document);

        // The flat layout had no interleaving to restore: its top-down order is rebuilt instead.
        const turn = panel.querySelector(".assistant")!;
        expect(Array.from(turn.children).map((c) => c.className.split(" ")[0])).toEqual([
            "toolCard",
            "markdown",
            "msgFooter",
        ]);
    });

    test("restores the interleaving of a turn saved with parts", () => {
        const stored: StoredMessage = {
            role: "assistant",
            text: "Drawn",
            time: 2,
            parts: [
                { type: "thinking", text: "let me see what is there", ms: 3000 },
                { type: "text", text: "Looking" },
                { type: "tool", name: "screenshot", args: "{}", result: "{}" },
                { type: "text", text: "Drawn" },
            ],
            workedMs: 2000,
            usage: {
                inputTokens: 10,
                outputTokens: 20,
                cacheReadTokens: 30,
                cacheCreationTokens: 40,
            },
        };
        const document = documentWith("d1", conversationOf("c1", [userMessage("draw", 1), stored]));

        const panel = panelOn(document);

        const turn = panel.querySelector(".assistant")!;
        expect(Array.from(turn.children).map((c) => c.className.split(" ")[0])).toEqual([
            "thinkingBlock",
            "markdown",
            "toolCard",
            "markdown",
            "msgFooter",
        ]);
        expect(turn.querySelector(".markdown")?.textContent?.trim()).toBe("Looking");
        expect(turn.querySelector(".msgWorked")?.textContent).toBe("ai.workedFor");
        // The meter picks the context back up, so reopening a conversation is not read as empty.
        expect(panel.querySelector(".contextText")?.textContent).toBe("80 / 1M");
        // Reasoning comes back folded: it is context for reading the turn, not the turn itself.
        const thinking = turn.querySelector(".thinkingBlock")!;
        expect(thinking.classList.contains("open")).toBe(false);
        expect(thinking.querySelector(".thinkingSummary")?.textContent).toBe("ai.thoughtFor");
        expect(thinking.querySelector(".thinkingBody")?.textContent).toBe("let me see what is there");
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

    test("history overlay carries the panel's own close button", () => {
        const panel = new ChatPanel();
        const anyPanel = panel as any;
        const onClose = rs.fn(() => {});
        panel.onClose = onClose;

        anyPanel.showHistory();
        const overlay = panel.querySelector(".historyOverlay") as HTMLElement;
        const buttons = overlay.querySelectorAll<HTMLButtonElement>(".historyHeader .iconButton");
        expect(buttons.length).toBe(2);

        buttons[1].click();

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(overlay.style.display).toBe("flex");
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

    test("takes the composer's place while it waits, then lands in the turn", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());

        const sending = startAsk(panel, { question: "how big?", options: ["6mm", "8mm"] });
        await flush();

        const card = panel.querySelector(".askCard")!;
        expect(card.querySelector(".askQuestion")?.textContent).toBe("how big?");
        expect(card.querySelectorAll(".askOption").length).toBe(2);
        // Blocked on the answer, the question stands where the hands already are — not up in the
        // transcript, where a long turn would carry it out of view.
        const composer = panel.querySelector(".composer")!;
        const composerCard = panel.querySelector(".composerCard") as HTMLElement;
        expect(composer.contains(card)).toBe(true);
        expect(composerCard.style.display).toBe("none");

        (card.querySelectorAll(".askOption")[1] as HTMLButtonElement).click();
        await sending;

        expect(card.classList.contains("askAnswered")).toBe(true);
        expect(card.querySelector(".askAnswer")?.textContent).toBe("8mm");
        // Answered, it falls back into the turn where the question was asked, and the composer
        // returns — the card's controls are gone, so the input has to.
        const assistantEl = panel.querySelector(".assistant")!;
        expect(assistantEl.contains(card)).toBe(true);
        expect(composer.querySelector(".askCard")).toBeNull();
        expect(composerCard.style.display).toBe("");
        // The reply that came after the answer is drawn below the card, in stream order.
        expect(card.nextElementSibling?.className).toBe("markdown");
        expect(panel.querySelector(".markdown")?.textContent).toContain("done");
        // The handler drew this card, so onToolCall must not have drawn a second one for it
        expect(panel.querySelectorAll(".askCard").length).toBe(1);
        expect(panel.querySelector(".toolCard")).toBeNull();
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

    test("brings the waiting dots back once the user has answered", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());
        let answered: (answer: string) => void = () => {};
        let resume: () => void = () => {};
        const seen = new Promise<string>((resolve) => (answered = resolve));
        agentMock.runAgent.mockImplementationOnce(async (opts: any) => {
            const tool = opts.tools.find((t: { name: string }) => t.name === "ask_user");
            const answer = String(
                await tool.handler({ question: "how big?", options: ["6mm"] }, opts.signal),
            );
            // Stand in for the round trip the model takes before its first token: the run is
            // back at work the moment the answer lands, and the dots have to say so.
            answered(answer);
            await new Promise<void>((resolve) => (resume = resolve));
            opts.callbacks.onTextDelta("done");
        });

        const anyPanel = panel as any;
        anyPanel.input.value = "cut a hole";
        const sending = anyPanel.send();
        await flush();

        // Waiting on the user is not work — the card itself is the indicator.
        expect(panel.querySelector(".thinkingDots")).toBeNull();

        (panel.querySelector(".askOption") as HTMLButtonElement).click();
        await seen;
        expect(panel.querySelector(".thinkingDots")).not.toBeNull();

        resume();
        await sending;
        expect(panel.querySelector(".thinkingDots")).toBeNull();
    });

    test("stops the run from the question card itself", async () => {
        saveConfig({ provider: "anthropic", apiKey: "k", model: "m" });
        const panel = panelOn(createMockDocument());

        const sending = startAsk(panel, { question: "how big?" });
        await flush();
        const card = panel.querySelector(".askCard")!;

        // The card holds the composer's place, so it has to carry the composer's way out too.
        (card.querySelector(".askStop") as HTMLButtonElement).click();
        await sending;

        expect(card.querySelector(".askAnswer")?.textContent).toBe("ai.ask.notAnswered");
        expect(card.querySelector(".askStop")).toBeNull();
        expect((panel.querySelector(".composerCard") as HTMLElement).style.display).toBe("");
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
