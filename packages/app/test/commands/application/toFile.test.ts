// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DOCUMENT_FILE_EXTENSION, PubSub } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { describe, expect, rs, test } from "@rstest/core";
import { SaveDocumentToFile } from "../../../src/commands/application/toFile";

describe("SaveDocumentToFile", () => {
    test("should have command metadata", () => {
        const data = (SaveDocumentToFile as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("doc.saveToFile");
        expect(data.icon).toBe("icon-download");
    });

    test("should do nothing when no active document", async () => {
        let published = false;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string) => {
            if (channel === "showPermanent") {
                published = true;
            }
        }) as any;

        try {
            const app = createMockApplication();
            app.activeView = undefined;

            const cmd = new SaveDocumentToFile();
            await expect(cmd.execute(app)).resolves.toBeUndefined();

            // No permanent action is triggered without an active document
            expect(published).toBe(false);
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should not publish showPermanent when activeView has no document", async () => {
        let published = false;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string) => {
            if (channel === "showPermanent") {
                published = true;
            }
        }) as any;

        try {
            const app = createMockApplication();
            (app as any).activeView = { document: undefined };

            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(published).toBe(false);
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should publish showPermanent event when document exists", async () => {
        let publishedChannel = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            publishedChannel = channel;
        }) as any;

        try {
            const doc = createMockDocument();
            doc.serialize = () => ({ test: true }) as any;
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(publishedChannel).toBe("showPermanent");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should have DOCUMENT_FILE_EXTENSION available", () => {
        const cmd = new SaveDocumentToFile();
        expect(cmd).toBeInstanceOf(SaveDocumentToFile);
        expect(typeof DOCUMENT_FILE_EXTENSION).toBe("string");
        expect(DOCUMENT_FILE_EXTENSION.length).toBeGreaterThan(0);
    });

    test("should implement ICommand (has execute method)", () => {
        const cmd = new SaveDocumentToFile();
        expect(typeof cmd.execute).toBe("function");
    });

    test("should pass executing template to showPermanent", async () => {
        let templateArg = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") {
                templateArg = args[1] as string;
            }
        }) as any;

        try {
            const doc = createMockDocument();
            doc.serialize = () => ({}) as any;
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(templateArg).toBe("toast.excuting{0}");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should pass a function as the callback to showPermanent", async () => {
        let callbackArg: unknown;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") {
                callbackArg = args[0];
            }
        }) as any;

        try {
            const doc = createMockDocument();
            doc.serialize = () => ({}) as any;
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(callbackArg).not.toBeNull();
            expect(typeof callbackArg).toBe("function");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should not publish showPermanent when activeView is undefined", async () => {
        let published = false;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string) => {
            if (channel === "showPermanent") {
                published = true;
            }
        }) as any;

        try {
            const app = createMockApplication();
            app.activeView = undefined;

            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(published).toBe(false);
        } finally {
            PubSub.default.pub = originalPub;
        }
    });
});

describe("SaveDocumentToFile callback", () => {
    function setupCallbackTest() {
        const state: {
            callback: (() => Promise<void>) | undefined;
            serializeCalled: boolean;
            downloadBlobData: BlobPart[] | null;
            downloadFileName: string | null;
            toastCalled: boolean;
        } = {
            callback: undefined,
            serializeCalled: false,
            downloadBlobData: null,
            downloadFileName: null,
            toastCalled: false,
        };

        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") {
                state.callback = args[0] as () => Promise<void>;
            }
            if (channel === "showToast") {
                state.toastCalled = true;
            }
        }) as any;

        const doc = createMockDocument({ name: "test-document" });
        doc.serialize = () => {
            state.serializeCalled = true;
            return { id: "123", name: "test-document" } as any;
        };

        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        // The command callback waits on a setTimeout(100) before serializing;
        // fake timers let tests advance that delay deterministically.
        rs.useFakeTimers();

        // Stub URL.createObjectURL / revokeObjectURL used by download()
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = (_blob: Blob) => "blob:mock-url";
        URL.revokeObjectURL = (_url: string) => {};

        // Record the file name the download is for; the click itself does nothing here.
        const originalCreateElement = document.createElement.bind(document);
        document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
            const el = originalCreateElement(tagName, options);
            if (tagName.toLowerCase() === "a") {
                Object.defineProperty(el, "download", {
                    set: (value: string) => {
                        state.downloadFileName = value;
                    },
                    get: () => state.downloadFileName ?? "",
                    configurable: true,
                });
                (el as HTMLElement).click = () => {};
            }
            return el;
        }) as typeof document.createElement;

        const restore = () => {
            PubSub.default.pub = originalPub;
            rs.useRealTimers();
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
            document.createElement = originalCreateElement;
        };

        return { state, app, restore };
    }

    /** Run the showPermanent callback to completion, advancing the internal timer delay. */
    async function runCallback(state: { callback: (() => Promise<void>) | undefined }) {
        if (!state.callback) return;
        const callbackPromise = state.callback();
        await rs.advanceTimersByTimeAsync(100);
        await callbackPromise;
    }

    test("should serialize the document inside the callback", async () => {
        const { state, app, restore } = setupCallbackTest();

        try {
            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(state.callback).not.toBeUndefined();
            await runCallback(state);

            expect(state.serializeCalled).toBe(true);
        } finally {
            restore();
        }
    });

    test("should publish downloading toast inside the callback", async () => {
        const { state, app, restore } = setupCallbackTest();

        try {
            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            expect(state.toastCalled).toBe(false);

            await runCallback(state);

            expect(state.toastCalled).toBe(true);
        } finally {
            restore();
        }
    });

    test("should download the document that was active when the command ran", async () => {
        const { state, app, restore } = setupCallbackTest();
        const otherDoc = createMockDocument({ name: "other-document" });

        try {
            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            // The user switches views while the spinner paints; the click's document is the
            // one the download is for.
            app.activeView = { document: otherDoc } as any;
            await runCallback(state);

            expect(state.downloadFileName).toContain("test-document");
        } finally {
            restore();
        }
    });

    test("should ignore a second download while the first is still running", async () => {
        const callbacks: Array<() => Promise<void>> = [];
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") callbacks.push(args[0] as () => Promise<void>);
        }) as any;
        rs.useFakeTimers();
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = () => "blob:mock-url";
        URL.revokeObjectURL = () => {};

        try {
            const doc = createMockDocument({ name: "test-document" });
            doc.serialize = () => ({}) as any;
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            await new SaveDocumentToFile().execute(app);
            // The work starts when `Permanent` runs the callback, and is still inside its
            // 100ms paint delay when the second click arrives — the guard must cover that.
            const first = callbacks[0]();
            await rs.advanceTimersByTimeAsync(20);

            await new SaveDocumentToFile().execute(app);
            expect(callbacks.length).toBe(1);

            await rs.advanceTimersByTimeAsync(100);
            await first;

            // Once the work is done, the next download goes through.
            await new SaveDocumentToFile().execute(app);
            expect(callbacks.length).toBe(2);
        } finally {
            PubSub.default.pub = originalPub;
            rs.useRealTimers();
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
        }
    });

    test("should create a download link with document name and extension", async () => {
        const { state, app, restore } = setupCallbackTest();

        // Track what the download creates
        const originalCreateElement = document.createElement.bind(document);
        let anchorDownload = "";
        document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
            const el = originalCreateElement(tagName, options);
            if (tagName.toLowerCase() === "a") {
                const anchor = el as HTMLAnchorElement;
                Object.defineProperty(anchor, "download", {
                    set: (v: string) => {
                        anchorDownload = v;
                    },
                    configurable: true,
                });
                (anchor as any).click = () => {};
            }
            return el;
        }) as typeof document.createElement;

        try {
            const cmd = new SaveDocumentToFile();
            await cmd.execute(app);

            await runCallback(state);

            expect(anchorDownload).toContain("test-document");
            expect(anchorDownload).toContain(DOCUMENT_FILE_EXTENSION);
        } finally {
            document.createElement = originalCreateElement;
            restore();
        }
    });
});
