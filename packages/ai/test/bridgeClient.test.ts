// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { connectBridge } from "../src/bridge";

/** Minimal stand-in for the browser's WebSocket, driven by the test. */
class FakeSocket {
    static readonly OPEN = 1;
    static instances: FakeSocket[] = [];

    readyState = 0;
    readonly sent: string[] = [];
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

    constructor(readonly url: string) {
        FakeSocket.instances.push(this);
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(code = 1005): void {
        this.serverClose(code);
    }

    // --- what the browser would do -------------------------------------------------------------
    open(): void {
        this.readyState = FakeSocket.OPEN;
        this.emit("open", {});
    }

    receive(message: unknown): void {
        this.emit("message", { data: JSON.stringify(message) });
    }

    serverClose(code: number): void {
        this.readyState = 3;
        this.emit("close", { code });
    }

    private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

/** A constructor that throws the way a blocked mixed-content WebSocket does. */
class BlockedSocket {
    static readonly OPEN = 1;
    constructor() {
        const error = new Error("insecure WebSocket");
        error.name = "SecurityError";
        throw error;
    }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function badgeText(): string | undefined {
    return document.querySelector(".chili3d-bridge-badge")?.textContent ?? undefined;
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (check()) return;
        await delay(10);
    }
    throw new Error("timed out waiting for the bridge client");
}

describe("bridge client", () => {
    beforeEach(() => {
        FakeSocket.instances = [];
        rs.stubGlobal("WebSocket", FakeSocket);
    });

    afterEach(() => {
        rs.unstubAllGlobals();
        document.body.replaceChildren();
    });

    test("sends hello with the page's tool list on open", () => {
        const stop = connectBridge(17999);
        try {
            const socket = FakeSocket.instances[0];
            socket.open();
            const hello = JSON.parse(socket.sent[0]);
            expect(hello.type).toBe("hello");
            expect(hello.protocol).toBe(1);
            expect(hello.tools.some((tool: { name: string }) => tool.name === "run_program")).toBe(true);
        } finally {
            stop();
        }
    });

    test("answers a call with the tool's result, and reports an unknown tool", async () => {
        const stop = connectBridge(17999);
        try {
            const socket = FakeSocket.instances[0];
            socket.open();
            socket.receive({ type: "call", id: "1", name: "definitely_not_a_tool", args: {} });
            await waitFor(() => socket.sent.length >= 2);
            expect(JSON.parse(socket.sent[1])).toEqual({
                type: "result",
                id: "1",
                ok: false,
                content: "Unknown tool: definitely_not_a_tool",
            });
        } finally {
            stop();
        }
    });

    test("does not retry a close that means another page took over", async () => {
        const stop = connectBridge(17999);
        try {
            FakeSocket.instances[0].open();
            FakeSocket.instances[0].serverClose(4002);
            expect(badgeText()).toBe("○ AI bridge (taken over)");
            await delay(700);
            expect(FakeSocket.instances.length).toBe(1);
        } finally {
            stop();
        }
    });

    test("does not retry a refused handshake and reports it", async () => {
        const stop = connectBridge(17999);
        try {
            FakeSocket.instances[0].open();
            FakeSocket.instances[0].serverClose(4003);
            expect(badgeText()).toBe("○ AI bridge (closed)");
            await delay(700);
            expect(FakeSocket.instances.length).toBe(1);
        } finally {
            stop();
        }
    });

    test("a synchronous constructor throw is a blocked state, not a crashed app", () => {
        rs.stubGlobal("WebSocket", BlockedSocket);
        const stop = connectBridge(17999);
        try {
            expect(badgeText()).toBe("○ AI bridge (blocked)");
        } finally {
            stop();
        }
    });

    test("retries a transport close", async () => {
        const stop = connectBridge(17999);
        try {
            FakeSocket.instances[0].open();
            FakeSocket.instances[0].serverClose(1006);
            await waitFor(() => FakeSocket.instances.length === 2);
        } finally {
            stop();
        }
    });

    test("stop removes the badge and a late close does not bring it back", async () => {
        const stop = connectBridge(17999);
        const socket = FakeSocket.instances[0];
        socket.open();
        expect(document.querySelectorAll(".chili3d-bridge-badge").length).toBe(1);

        stop();
        expect(document.querySelectorAll(".chili3d-bridge-badge").length).toBe(0);

        socket.serverClose(1006);
        await delay(20);
        expect(document.querySelectorAll(".chili3d-bridge-badge").length).toBe(0);
    });
});
