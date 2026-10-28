// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BridgeStatus, PubSub } from "@chili3d/core";
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
const statusEvents: [BridgeStatus | undefined, string?][] = [];
const recordStatus = (status: BridgeStatus | undefined, title?: string) => {
    statusEvents.push([status, title]);
};
const lastStatus = () => statusEvents.at(-1)?.[0];

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
        statusEvents.length = 0;
        PubSub.default.sub("bridgeStatusChanged", recordStatus);
        rs.stubGlobal("WebSocket", FakeSocket);
    });

    afterEach(() => {
        PubSub.default.remove("bridgeStatusChanged", recordStatus);
        rs.unstubAllGlobals();
    });

    test("publishes connecting and connected states, then sends the tool list", () => {
        const stop = connectBridge(17999);
        try {
            expect(lastStatus()).toBe("retrying");
            const socket = FakeSocket.instances[0];
            socket.open();
            expect(statusEvents.at(-1)).toEqual([
                "connected",
                "Connected to the local bridge on 127.0.0.1:17999",
            ]);
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
            expect(statusEvents.at(-1)).toEqual([
                "replaced",
                "Another tab took over the bridge. Reload this page to take it back.",
            ]);
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
            expect(lastStatus()).toBe("closed");
            expect(statusEvents.at(-1)?.[1]).toContain("The bridge closed this session");
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
            expect(statusEvents.at(-1)).toEqual([
                "blocked",
                "The browser blocked the local WebSocket (mixed content or a security policy).",
            ]);
        } finally {
            stop();
        }
    });

    test("retries a transport close", async () => {
        const stop = connectBridge(17999);
        try {
            FakeSocket.instances[0].open();
            FakeSocket.instances[0].serverClose(1006);
            expect(lastStatus()).toBe("retrying");
            await waitFor(() => FakeSocket.instances.length === 2);
        } finally {
            stop();
        }
    });

    test("stop clears the status and a late close does not restore it", async () => {
        const stop = connectBridge(17999);
        const socket = FakeSocket.instances[0];
        socket.open();
        expect(lastStatus()).toBe("connected");

        stop();
        expect(lastStatus()).toBeUndefined();
        const eventCount = statusEvents.length;

        socket.serverClose(1006);
        await delay(20);
        expect(statusEvents.length).toBe(eventCount);
        expect(lastStatus()).toBeUndefined();
    });
});
