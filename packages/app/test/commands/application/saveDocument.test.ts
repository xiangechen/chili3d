// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, PubSub } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import { SaveDocument } from "../../../src/commands/application/saveDocument";

describe("SaveDocument", () => {
    test("should have command metadata", () => {
        const data = (SaveDocument as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("doc.save");
        expect(data.icon).toBe("icon-save");
    });

    test("should be marked alwaysAvailable (no view, no queue)", () => {
        const data = (SaveDocument as any).prototype.data;
        expect(data.alwaysAvailable).toBe(true);
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

            const cmd = new SaveDocument();
            await cmd.execute(app);

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

            const cmd = new SaveDocument();
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
            doc.save = async () => {};
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            const cmd = new SaveDocument();
            await cmd.execute(app);

            expect(publishedChannel).toBe("showPermanent");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should implement ICommand (has execute method)", () => {
        const cmd = new SaveDocument();
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
            doc.save = async () => {};
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            const cmd = new SaveDocument();
            await cmd.execute(app);

            expect(templateArg).toBe("toast.excuting{0}");
        } finally {
            PubSub.default.pub = originalPub;
        }
    });
});

describe("SaveDocument callback", () => {
    /**
     * Capture the showPermanent callback and set up document.save tracking.
     */
    function setupCallbackTest() {
        const state: {
            callback: (() => Promise<void>) | undefined;
            saveCalled: boolean;
            toastChannel: string;
            toastMessage: string;
        } = {
            callback: undefined,
            saveCalled: false,
            toastChannel: "",
            toastMessage: "",
        };

        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") {
                state.callback = args[0] as () => Promise<void>;
            }
            if (channel === "showToast") {
                state.toastChannel = channel;
                state.toastMessage = args[0] as string;
            }
        }) as any;

        const doc = createMockDocument();
        doc.save = async () => {
            state.saveCalled = true;
        };

        const app = createMockApplication();
        app.activeView = { document: doc } as any;

        const restore = () => {
            PubSub.default.pub = originalPub;
        };

        return { state, app, restore };
    }

    test("should call document.save() inside the callback", async () => {
        const { state, app, restore } = setupCallbackTest();

        try {
            const cmd = new SaveDocument();
            await cmd.execute(app);

            expect(state.callback).not.toBeUndefined();
            await state.callback!();

            expect(state.saveCalled).toBe(true);
        } finally {
            restore();
        }
    });

    test("should publish toast after saving", async () => {
        const { state, app, restore } = setupCallbackTest();

        try {
            const cmd = new SaveDocument();
            await cmd.execute(app);

            expect(state.callback).not.toBeUndefined();
            await state.callback!();

            expect(state.toastChannel).toBe("showToast");
            expect(state.toastMessage).toBe("toast.document.saved");
        } finally {
            restore();
        }
    });

    test("should publish showToast ONLY after save completes", async () => {
        const { state, app, restore } = setupCallbackTest();

        try {
            const cmd = new SaveDocument();
            await cmd.execute(app);

            // Before callback runs, toast should not have been published
            expect(state.toastChannel).toBe("");

            expect(state.callback).not.toBeUndefined();
            await state.callback!();

            // After callback runs, toast should be published
            expect(state.toastChannel).toBe("showToast");
        } finally {
            restore();
        }
    });

    test("should ignore a second save while the first is still running", async () => {
        const callbacks: Array<() => Promise<void>> = [];
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            if (channel === "showPermanent") callbacks.push(args[0] as () => Promise<void>);
        }) as any;

        try {
            const doc = createMockDocument();
            let release!: () => void;
            doc.save = () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                });
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            await new SaveDocument().execute(app);
            // What `Permanent` does with the published callback; the work runs here, and the
            // command call itself has already returned.
            const first = callbacks[0]();
            await Promise.resolve();

            // A real second click/keypress arrives in a later task.
            await new SaveDocument().execute(app);
            expect(callbacks.length).toBe(1);

            release();
            await first;

            // Once the work is done, the next save goes through.
            await new SaveDocument().execute(app);
            expect(callbacks.length).toBe(2);
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should report a failed save instead of claiming it worked", async () => {
        const events: any[][] = [];
        let callback: (() => Promise<void>) | undefined;
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            events.push([channel, ...args]);
            if (channel === "showPermanent") {
                callback = args[0] as () => Promise<void>;
            }
        }) as any;

        try {
            const doc = createMockDocument();
            doc.save = async () => {
                throw new Error("quota exceeded");
            };
            const app = createMockApplication();
            app.activeView = { document: doc } as any;

            await new SaveDocument().execute(app);
            await callback!();

            expect(events.filter(([channel]) => channel === "showToast")).toEqual([]);
            expect(events.find(([channel]) => channel === "displayError")?.[1]).toBe(
                I18n.translate("toast.document.saveFailed{0}", "quota exceeded"),
            );
        } finally {
            PubSub.default.pub = originalPub;
        }
    });

    test("should tell the user when there is no document to save", async () => {
        const events: any[][] = [];
        const originalPub = PubSub.default.pub;
        PubSub.default.pub = ((channel: string, ...args: any[]) => {
            events.push([channel, ...args]);
        }) as any;

        try {
            const app = createMockApplication();
            app.activeView = undefined;

            await new SaveDocument().execute(app);

            expect(events).toEqual([["showToast", "toast.document.noActivated"]]);
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

            const cmd = new SaveDocument();
            await cmd.execute(app);

            expect(published).toBe(false);
        } finally {
            PubSub.default.pub = originalPub;
        }
    });
});
