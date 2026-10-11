// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// A scripted run of the real app in a real browser, from a committed scenario file.
//
// The point of the file is that it is reviewable and repeatable: the same steps run the
// same way next month, and a change to what they assert shows up as a diff rather than as
// a paragraph in a PR description. Driving the app by hand through DevTools is what this
// replaces — the ad-hoc scripts that had to re-discover, every time, that headless Chrome
// needs a software GL, that an open alert swallows every later command, and that a hover
// has to be moved to before it is clicked.
//
// Two things make a step reliable rather than timing-dependent:
//
// - **The app says when it is idle.** Every step waits for `__chiliTest.settled()` — no
//   async work in flight, then a frame to draw what it left — so a scenario needs a `wait`
//   only for what runs on its own clock (an animation, a tooltip delay).
// - **Steps address things, not pixels.** `runCommand` goes through the app's own command
//   entry point and `world` steps are in model millimetres, so a scenario does not break
//   when the ribbon is re-arranged or the window is a different size.
//
// Run: npm run dev            (in another terminal; the runner does not start the server)
//      npm run test:scenarios [name ...]        (all of them when no name is given)
//
// Env: CHILI3D_URL (default http://localhost:8080), CHROME (browser binary),
//      SCENARIO_OUT (default <repo>/test/scenarios)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const SCENARIO_DIR = resolve(repoRoot, "packages/parametric/test/scenarios");
const OUT_ROOT = resolve(process.env.SCENARIO_OUT ?? join(repoRoot, "test", "scenarios"));
const URL_BASE = process.env.CHILI3D_URL ?? "http://localhost:8080";

const CHROME_CANDIDATES = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter((candidate) => candidate !== undefined);

function findChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        if (existsSync(candidate)) return candidate;
    }
    throw new Error(
        `No Chrome found. Set CHROME to the browser binary. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
    );
}

// ---------------------------------------------------------------------------------------------
// A minimal CDP client: Node's own WebSocket, no browser-driving dependency.

class Cdp {
    #socket;
    #nextId = 1;
    #pending = new Map();
    #listeners = new Map();

    static async attach(webSocketDebuggerUrl) {
        const client = new Cdp();
        client.#socket = new WebSocket(webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            client.#socket.addEventListener("open", resolve, { once: true });
            client.#socket.addEventListener("error", () => reject(new Error("CDP socket failed")), {
                once: true,
            });
        });
        client.#socket.addEventListener("message", (event) => client.#receive(event.data));
        return client;
    }

    #receive(data) {
        const message = JSON.parse(typeof data === "string" ? data : data.toString());
        if (message.id !== undefined) {
            const entry = this.#pending.get(message.id);
            this.#pending.delete(message.id);
            if (entry === undefined) return;
            if (message.error !== undefined) entry.reject(new Error(`${message.error.message}`));
            else entry.resolve(message.result);
            return;
        }
        for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params);
    }

    on(method, listener) {
        const list = this.#listeners.get(method) ?? [];
        list.push(listener);
        this.#listeners.set(method, list);
    }

    send(method, params = {}) {
        const id = this.#nextId++;
        this.#socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    }

    close() {
        this.#socket.close();
    }
}

// ---------------------------------------------------------------------------------------------
// Driving the page

class Page {
    constructor(cdp) {
        this.cdp = cdp;
    }

    /** Evaluates an expression in the page, serialized back as JSON. */
    async evaluate(expression) {
        const result = await this.cdp.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails !== undefined) {
            throw new Error(
                `In the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
            );
        }
        return result.result.value;
    }

    /**
     * The app's own answer first, then a frame for it to be drawn. A page that has not
     * built the app yet has no `__chiliTest`, which is itself "not settled".
     *
     * The timeout is not a substitute for the wait — it is what turns a wait that can
     * never finish into a failure that says so. A background tab gets no animation
     * frames, so a page that is open but not front-most would hang here forever; with the
     * race it says which step it was waiting for.
     */
    async settled(timeoutMs = 30000) {
        const wait = this.evaluate(
            "globalThis.__chiliTest ? globalThis.__chiliTest.settled() : new Promise((r) => setTimeout(r, 50))",
        );
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`the app did not settle within ${timeoutMs}ms`)),
                timeoutMs,
            );
        });
        try {
            await Promise.race([wait, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * One mouse event. `held` is the button mask the event carries — a move that happens
     * with a button down says so, and a move that is only passing over the page says
     * none. The distinction is not decoration: the view gizmo orbits the camera on any
     * move whose `event.buttons` says a drag, so a bare hover marked as held turns the
     * view every time a script crosses the gizmo.
     */
    async pointer(type, x, y, button = "left", held = false) {
        await this.cdp.send("Input.dispatchMouseEvent", {
            type,
            x,
            y,
            button,
            buttons: held ? 1 : 0,
            clickCount: type === "mouseMoved" ? 0 : 1,
        });
    }

    /** A viewport point in CSS pixels, moved to first — a click on an untouched page lands nowhere. */
    async clickAt(x, y, button = "left") {
        await this.pointer("mouseMoved", x, y);
        await this.pointer("mousePressed", x, y, button, true);
        await this.pointer("mouseReleased", x, y, button);
    }

    async drag(from, to, button = "left") {
        await this.pointer("mouseMoved", from.x, from.y);
        await this.pointer("mousePressed", from.x, from.y, button, true);
        for (let step = 1; step <= 8; step++) {
            const t = step / 8;
            await this.pointer(
                "mouseMoved",
                from.x + (to.x - from.x) * t,
                from.y + (to.y - from.y) * t,
                button,
                true,
            );
        }
        await this.pointer("mouseReleased", to.x, to.y, button);
    }

    async key(text) {
        const parts = text.split("+");
        const key = parts.pop();
        const modifiers = parts.reduce((mask, name) => mask | (MODIFIERS[name] ?? 0), 0);
        const code = KEY_CODES[key] ?? key;
        const common = { key: code, code: code.length === 1 ? `Key${code.toUpperCase()}` : code, modifiers };
        await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...common });
        await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
    }

    async type(text) {
        for (const character of text) {
            await this.cdp.send("Input.dispatchKeyEvent", { type: "char", text: character });
        }
    }

    /**
     * A model-space point, in the viewport's pixels. The app exposes the active view, so
     * this asks it rather than re-deriving a projection the runner cannot see.
     */
    async worldToScreen(x, y, z = 0) {
        const point = await this.evaluate(`(() => {
            const view = globalThis.activeView;
            if (!view) return undefined;
            const p = view.worldToScreen?.({ x: ${x}, y: ${y}, z: ${z} });
            return p ? { x: p.x, y: p.y } : undefined;
        })()`);
        if (point === undefined) throw new Error("The view could not map a world point to the screen");
        return point;
    }

    async screenshot(path) {
        const { data } = await this.cdp.send("Page.captureScreenshot", { format: "png" });
        const bytes = Buffer.from(data, "base64");
        // A blank capture is a silently useless artifact — the whole point of the
        // screenshot is to be looked at, and a black canvas passes a byte count.
        writeFileSync(path, bytes);
        return bytes.length;
    }
}

/** The page's own console text, flattened: `Runtime.consoleAPICalled` carries RemoteObjects. */
function describeRemote(params) {
    return (params.args ?? [])
        .map((argument) => argument.value ?? argument.description ?? argument.type)
        .join(" ");
}

/**
 * Finds an element anywhere in the page, shadow roots included. The app's own panels are
 * plain DOM, but the viewport lives under a shadow root — a plain `document.querySelector`
 * would report a running app as missing its canvas.
 */
const FIND_IN_PAGE = `(function findInPage(selector) {
    const search = (root) => {
        if (root.querySelector?.(selector)) return true;
        for (const element of root.querySelectorAll("*")) {
            if (element.shadowRoot && search(element.shadowRoot)) return true;
        }
        return false;
    };
    return search(document);
})`;

const MODIFIERS = { Shift: 8, Control: 2, Alt: 1, Meta: 4 };
const KEY_CODES = {
    Escape: "Escape",
    Enter: "Enter",
    Delete: "Delete",
    Backspace: "Backspace",
    Tab: "Tab",
};

// ---------------------------------------------------------------------------------------------
// Scenarios

function loadScenario(name) {
    const path = join(SCENARIO_DIR, `${name}.json`);
    const scenario = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
        throw new Error(`${name}: a scenario needs at least one step`);
    }
    return scenario;
}

function scenarioNames(argv) {
    const named = argv.filter((argument) => !argument.startsWith("--"));
    if (named.length > 0) return named;
    if (!existsSync(SCENARIO_DIR)) return [];
    return readdirSync(SCENARIO_DIR)
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => entry.slice(0, -".json".length))
        .sort();
}

async function runStep(page, step, context) {
    switch (step.kind) {
        case "runCommand":
            // Through the app's own entry point: the same door a ribbon button uses, so a
            // scenario does not encode where the button happens to sit.
            await page.evaluate(`globalThis.__chiliTest.dispatch(${JSON.stringify(step.name)})`);
            return;
        case "eval": {
            const result = await page.evaluate(step.expression);
            if (step.log === true) console.log(`     ${JSON.stringify(result)}`);
            return result;
        }
        case "clickAt":
            return page.clickAt(step.x, step.y);
        case "clickWorld": {
            const point = await page.worldToScreen(step.x, step.y, step.z ?? 0);
            return page.clickAt(point.x, point.y);
        }
        case "moveWorld": {
            const point = await page.worldToScreen(step.x, step.y, step.z ?? 0);
            return page.pointer("mouseMoved", point.x, point.y);
        }
        case "dragWorld": {
            const from = await page.worldToScreen(step.from[0], step.from[1], step.from[2] ?? 0);
            const to = await page.worldToScreen(step.to[0], step.to[1], step.to[2] ?? 0);
            return page.drag(from, to);
        }
        case "key":
            return page.key(step.text);
        case "type":
            return page.type(step.text);
        case "waitFor": {
            const deadline = Date.now() + (step.timeout ?? 10000);
            while (Date.now() < deadline) {
                const found = await page.evaluate(`(${FIND_IN_PAGE})(${JSON.stringify(step.selector)})`);
                if (found) return;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            throw new Error(`waited for ${step.selector} and it never appeared`);
        }
        case "wait":
            return new Promise((resolve) => setTimeout(resolve, step.ms));
        case "screenshot":
            return page.screenshot(join(context.outDir, `${step.name}.png`));
        default:
            throw new Error(`Unknown step kind: ${step.kind}`);
    }
}

async function runScenario(browser, name) {
    const scenario = loadScenario(name);
    const outDir = join(OUT_ROOT, name);
    mkdirSync(outDir, { recursive: true });

    const page = await browser.newPage(URL_BASE);
    try {
        await page.cdp.send("Page.enable");
        await page.cdp.send("Runtime.enable");
        // Front-most: an unfocused tab gets no animation frames, and the settle handshake
        // waits on one.
        await page.cdp.send("Page.bringToFront");
        // What the page said, kept for the failure message: a boot that dies on an
        // exception otherwise looks exactly like a boot that is slow.
        page.cdp.on("Runtime.consoleAPICalled", (params) => {
            if (params.type === "error") console.error(`     [page] ${describeRemote(params)}`);
        });
        page.cdp.on("Runtime.exceptionThrown", (params) => {
            console.error(`     [page] ${params.exceptionDetails?.exception?.description ?? "exception"}`);
        });
        await waitForApp(page, scenario.bootTimeout ?? 60000);
        // A scenario that works on a model says so: `"start": "document"` opens one first,
        // the way a person does, and waits for its viewport. Without it the app sits on
        // the landing screen and every later step would be acting on nothing.
        if (scenario.start === "document") await startDocument(page);

        const context = { outDir };
        for (const [index, step] of scenario.steps.entries()) {
            try {
                await runStep(page, step, context);
            } catch (error) {
                throw new Error(`step ${index + 1} (${step.kind}): ${error.message}`);
            }
            // Every step ends the same way: the app settles, then a frame draws it. A
            // scenario therefore says nothing about timing except where timing is the
            // thing under test.
            await page.settled();
        }
    } finally {
        await page.close();
    }
}

/**
 * Opens a document through the app's own command and waits for its viewport. Both halves
 * matter: a command is asynchronous, and the canvas only exists once the document's view
 * has been laid out.
 */
async function startDocument(page) {
    await page.evaluate(`globalThis.__chiliTest.dispatch("doc.new")`);
    await page.settled();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (await page.evaluate(`(${FIND_IN_PAGE})("canvas")`)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("the new document never produced a viewport");
}

/**
 * Waits until the app exists and its `__chiliTest` door is up. The loading screen is on
 * screen until the wasm kernel has initialized, which is the longest thing in a cold
 * start, so the wait is generous and the failure says what it was waiting for.
 */
async function waitForApp(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await page.evaluate("typeof globalThis.__chiliTest !== 'undefined'");
        if (ready) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("the app never finished starting (no __chiliTest — is `npm run dev` running?)");
}

// ---------------------------------------------------------------------------------------------

/**
 * The browser, as an object that opens pages on it. Chrome is asked for a tab per
 * scenario and the tab's own devtools socket is used — no `Target`/session bookkeeping,
 * because a page socket already addresses exactly one page.
 */
async function withChrome(callback) {
    const chrome = findChrome();
    const port = 9222 + (process.pid % 500);
    // In the OS temp dir, not beside the screenshots: a browser profile is thousands of
    // files and none of them are anybody's business.
    const profile = join(tmpdir(), `chili3d-scenario-${process.pid}`);
    mkdirSync(profile, { recursive: true });
    const child = spawn(
        chrome,
        [
            // `--headless=new` is a real browser without a window: the same rendering path
            // the app takes on a desktop, unlike the old headless which had none.
            "--headless=new",
            `--remote-debugging-port=${port}`,
            // Headless Chrome has no GPU, so without a software GL the viewport comes up
            // blank — and every canvas step would then be measuring nothing.
            "--use-gl=swiftshader",
            "--enable-unsafe-swiftshader",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
    );
    try {
        await waitForDevTools(port, child);
        return await callback({
            async newPage(url) {
                // Chrome wants PUT here (and answers GET with a 405 on current versions).
                const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
                    method: "PUT",
                });
                if (!response.ok) throw new Error(`could not open a tab: ${response.status}`);
                const target = await response.json();
                const cdp = await Cdp.attach(target.webSocketDebuggerUrl);
                const page = new Page(cdp);
                page.close = async () => {
                    cdp.close();
                    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
                };
                return page;
            },
        });
    } finally {
        child.kill("SIGKILL");
    }
}

async function waitForDevTools(port, child, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (response.ok) return await response.json();
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    child.kill("SIGKILL");
    throw new Error(`Chrome never opened its devtools port (${port})`);
}

async function main() {
    const names = scenarioNames(process.argv.slice(2));
    if (names.length === 0) {
        console.error(`No scenarios in ${SCENARIO_DIR}`);
        process.exit(2);
    }
    for (const name of names) loadScenario(name);

    const failures = [];
    await withChrome(async (browser) => {
        for (const name of names) {
            try {
                await runScenario(browser, name);
                console.log(`ok   ${name}`);
            } catch (error) {
                failures.push(name);
                console.error(`FAIL ${name}: ${error.message}`);
            }
        }
    });

    if (failures.length > 0) {
        console.error(`\n${failures.length} of ${names.length} scenarios failed`);
        process.exit(1);
    }
    console.log(`\n${names.length} scenarios passed`);
}

await main();
