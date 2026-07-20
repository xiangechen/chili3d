// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DOCUMENT_FILE_EXTENSION, PubSub } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";

import { SaveDocumentToFile } from "../../../src/commands/application/toFile";
import { createMockApplication, createMockDocument } from "../../_helpers";

describe("SaveDocumentToFile", () => {
    test("should have command metadata", () => {
        const data = (SaveDocumentToFile as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("doc.saveToFile");
        expect(data.icon).toBe("icon-download");
    });

    test("should do nothing when no active document", async () => {
        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);
    });

    test("should execute without throwing when activeView but no document", async () => {
        const app = createMockApplication();
        (app as any).activeView = { document: undefined };

        const cmd = new SaveDocumentToFile();
        await expect(cmd.execute(app)).resolves.toBeUndefined();
    });

    test("should publish showPermanent event when document exists", async () => {
        let publishedChannel = "";
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ..._args: any[]) => {
            publishedChannel = channel;
        }) as any;

        const doc = createMockDocument();
        doc.serialize = () => ({ test: true }) as any;
        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(publishedChannel).toBe("showPermanent");

        PubSub.default.pub = originalPub;
    });

    test("should have DOCUMENT_FILE_EXTENSION available", () => {
        const cmd = new SaveDocumentToFile();
        expect(cmd).toBeDefined();
        expect(DOCUMENT_FILE_EXTENSION).toBeDefined();
        expect(typeof DOCUMENT_FILE_EXTENSION).toBe("string");
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

        const doc = createMockDocument();
        doc.serialize = () => ({}) as any;
        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(templateArg).toBe("toast.excuting{0}");

        PubSub.default.pub = originalPub;
    });

    test("should pass a function as the callback to showPermanent", async () => {
        let callbackArg: unknown;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") {
                callbackArg = args[0];
            }
        }) as any;

        const doc = createMockDocument();
        doc.serialize = () => ({}) as any;
        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(callbackArg).toBeDefined();
        expect(typeof callbackArg).toBe("function");

        PubSub.default.pub = originalPub;
    });

    test("should not publish showPermanent when activeView is undefined", async () => {
        let published = false;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string) => {
            if (channel === "showPermanent") {
                published = true;
            }
        }) as any;

        const app = createMockApplication();
        app.activeView = undefined;

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(published).toBe(false);

        PubSub.default.pub = originalPub;
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

        // Stub setTimeout to run immediately
        const originalSetTimeout = globalThis.setTimeout;
        (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => {
            fn();
            return 0 as any;
        };

        // Stub URL.createObjectURL / revokeObjectURL used by download()
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = (_blob: Blob) => "blob:mock-url";
        URL.revokeObjectURL = (_url: string) => {};

        const restore = () => {
            PubSub.default.pub = originalPub;
            globalThis.setTimeout = originalSetTimeout;
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
        };

        return { state, app, restore };
    }

    test("should serialize the document inside the callback", async () => {
        const { state, app, restore } = setupCallbackTest();

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(state.callback).toBeDefined();
        if (state.callback) {
            await state.callback();
        }

        expect(state.serializeCalled).toBe(true);

        restore();
    });

    test("should publish downloading toast inside the callback", async () => {
        const { state, app, restore } = setupCallbackTest();

        const cmd = new SaveDocumentToFile();
        await cmd.execute(app);

        expect(state.toastCalled).toBe(false);

        if (state.callback) {
            await state.callback();
        }

        expect(state.toastCalled).toBe(true);

        restore();
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

            if (state.callback) {
                await state.callback();
            }

            expect(anchorDownload).toContain("test-document");
            expect(anchorDownload).toContain(DOCUMENT_FILE_EXTENSION);
        } finally {
            document.createElement = originalCreateElement;
            restore();
        }
    });
});
