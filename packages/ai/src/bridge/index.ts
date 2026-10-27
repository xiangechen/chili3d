// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The page half of the local bridge (see the `@chili3d/mcp` package): `?bridge=<port>` asks
 * this page to connect back to a local process, which forwards the calls an external agent makes
 * to the assistant's tool registry. The host is built here rather than looked up on a global —
 * this module ships with the tools it serves, so there is nothing to miss at runtime.
 *
 * Nothing is opened and nothing is loaded without the parameter: an ordinary visit never pays
 * for an agent feature. The connection is outbound because a tab cannot listen; the local process
 * is the server and the page is the client.
 */

import { createToolHost } from "../tools/host";

export const DEFAULT_BRIDGE_PORT = 17373;
const PROTOCOL = 1;
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];
/**
 * Close codes the daemon sends for a session it will answer the same way again: 4002 when a newer
 * page took the bridge, 4003 for a protocol mismatch or a missing hello. Retrying those turns two
 * open tabs into a replacement loop, so the client stops instead.
 */
const TERMINAL_CODES = new Set([4002, 4003]);

type ServerMessage = { type: "call"; id: string; name: string; args?: Record<string, unknown> };
type BridgeStatus = "connected" | "retrying" | "blocked" | "replaced" | "closed";

/** A mixed-content block is thrown synchronously by the `WebSocket` constructor. */
function isSecurityError(error: unknown): boolean {
    return (
        typeof error === "object" && error !== null && (error as { name?: string }).name === "SecurityError"
    );
}

function titleOf(status: BridgeStatus, port: number, detail?: string): string {
    switch (status) {
        case "connected":
            return `Connected to the local bridge on 127.0.0.1:${port}`;
        case "retrying":
            return "Reconnecting to the local bridge";
        case "blocked":
            return "The browser blocked the local WebSocket (mixed content or a security policy).";
        case "replaced":
            return "Another tab took over the bridge. Reload this page to take it back.";
        case "closed":
            // 4003 is also a version mismatch, which a reload does not fix.
            return `The bridge closed this session${detail ? `: ${detail}` : ""}. If it is a version mismatch, update the page or chili3d-mcp.`;
    }
}

/** The port `?bridge` names, or undefined when the page was not asked to connect at all. */
export function bridgePortFromUrl(search: string): number | undefined {
    const raw = new URLSearchParams(search).get("bridge");
    if (raw === null) return undefined;
    if (raw === "") return DEFAULT_BRIDGE_PORT;
    // Digits only, untrimmed: `Number` alone would take `0x10` and `1e3`, and `+17373` arrives
    // as " 17373" because a `+` in a query decodes to a space — all of them typos, not a port.
    if (!/^\d+$/.test(raw)) return undefined;
    const port = Number(raw);
    return port > 0 && port <= 65535 ? port : undefined;
}

/** Start the client; the returned function stops it. */
export function connectBridge(port: number): () => void {
    const client = new BridgeClient(port);
    client.start();
    return () => client.stop();
}

class BridgeClient {
    private readonly host = createToolHost();
    private socket?: WebSocket;
    private retry?: ReturnType<typeof setTimeout>;
    private attempts = 0;
    private stopped = false;
    private badge?: HTMLElement;
    /**
     * The daemon already sends one call at a time; this keeps the page correct for any sender and
     * keeps a rejected `receive` from escaping as an unhandled rejection.
     */
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly port: number) {}

    start(): void {
        this.connect();
    }

    stop(): void {
        this.stopped = true;
        clearTimeout(this.retry);
        this.socket?.close();
        this.badge?.remove();
        this.badge = undefined;
    }

    private connect(): void {
        if (this.stopped) return;
        let socket: WebSocket;
        try {
            socket = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
        } catch (error) {
            // A page served over HTTPS gets a synchronous SecurityError when the browser refuses
            // an insecure WebSocket. Left uncaught, it would escape `AppBuilder.build()` and the
            // whole app would fail to start — a bridge that cannot connect must be only that.
            this.setStatus(isSecurityError(error) ? "blocked" : "retrying");
            this.retryLater();
            return;
        }
        this.socket = socket;
        socket.addEventListener("open", () => {
            this.attempts = 0;
            this.send({ type: "hello", protocol: PROTOCOL, tools: this.host.list() });
            this.setStatus("connected");
        });
        socket.addEventListener("message", (event) => {
            this.queue = this.queue.then(() => this.receive(String(event.data))).catch(() => undefined);
        });
        socket.addEventListener("close", (event) => {
            // `stop()` closes the socket too; its close event must not draw the badge back.
            if (this.stopped) return;
            if (TERMINAL_CODES.has(event.code)) {
                this.setStatus(event.code === 4002 ? "replaced" : "closed", event.reason);
                return;
            }
            this.setStatus("retrying");
            this.retryLater();
        });
    }

    private retryLater(): void {
        if (this.stopped) return;
        const delay = RETRY_DELAYS[Math.min(this.attempts, RETRY_DELAYS.length - 1)];
        this.attempts++;
        this.retry = setTimeout(() => this.connect(), delay);
    }

    private async receive(raw: string): Promise<void> {
        let message: ServerMessage;
        try {
            message = JSON.parse(raw) as ServerMessage;
        } catch {
            return;
        }
        if (message.type !== "call") return;

        try {
            this.send({
                type: "result",
                id: message.id,
                ...(await this.host.call(message.name, message.args ?? {})),
            });
        } catch (error) {
            const content = error instanceof Error ? error.message : String(error);
            this.send({ type: "result", id: message.id, ok: false, content });
        }
    }

    private send(message: Record<string, unknown>): void {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }

    private setStatus(status: BridgeStatus, detail?: string): void {
        // `stop()` removed the badge on purpose; nothing may bring it back afterwards.
        if (this.stopped) return;
        this.badge ??= this.createBadge();
        const badge = this.badge;
        // The badge is a diagnostic for a `?bridge` session, and its brand word is English; the
        // states stay English rather than shipping a half-translated label.
        const labels: Record<BridgeStatus, string> = {
            connected: "● AI bridge",
            retrying: "○ AI bridge",
            blocked: "○ AI bridge (blocked)",
            replaced: "○ AI bridge (taken over)",
            closed: "○ AI bridge (closed)",
        };
        badge.textContent = labels[status];
        badge.style.color =
            status === "connected" ? "#7ee787" : status === "retrying" ? "#d29922" : "#8b949e";
        badge.title = titleOf(status, this.port, detail);
    }

    private createBadge(): HTMLElement {
        const badge = document.createElement("div");
        badge.className = "chili3d-bridge-badge";
        badge.style.cssText = [
            "position:fixed",
            "right:12px",
            "bottom:12px",
            "z-index:2147483647",
            "padding:4px 8px",
            "border-radius:6px",
            "background:rgba(0,0,0,.65)",
            "font:12px/1.2 system-ui,sans-serif",
            "pointer-events:none",
            "user-select:none",
        ].join(";");
        document.body.append(badge);
        return badge;
    }
}
