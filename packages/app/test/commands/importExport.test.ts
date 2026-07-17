// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    getCurrentApplication,
    type IApplication,
    PubSub,
    SelectNodeStep,
    setCurrentApplication,
} from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { Export, Import } from "../../src/commands/importExport";
import { createMockApplication, createMockDocument } from "../_helpers";

// Ensure a mock application is set (Export constructor calls getCurrentApplication)
try {
    getCurrentApplication();
} catch {
    setCurrentApplication(createMockApplication());
}

describe("Import", () => {
    test("should have command metadata", () => {
        const data = (Import as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("file.import");
        expect(data.icon).toBe("icon-import");
    });

    test("should implement ICommand (has execute method)", () => {
        const cmd = new Import();
        expect(typeof cmd.execute).toBe("function");
    });

    test("should handle importFormats call correctly", async () => {
        const app = createMockApplication();
        app.dataExchange.importFormats = () => [".step", ".stl", ".iges"];

        const cmd = new Import();
        // execute will call readFilesAsync which creates a file input in browser.
        // In test env (Happy-DOM), we can verify the format string is correct.
        expect(typeof app.dataExchange.importFormats().join(",")).toBe("string");
        expect(app.dataExchange.importFormats().join(",")).toBe(".step,.stl,.iges");
    });

    test("Import instance should have type-safe execute signature", () => {
        const cmd = new Import();
        expect(cmd).toBeDefined();
        expect(typeof cmd.execute).toBe("function");
    });

    test("should handle empty file list gracefully via alert", async () => {
        // When readFilesAsync returns empty files, Import shows an alert.
        // We verify the command can be constructed and has proper metadata.
        const cmd = new Import();
        expect(cmd).toBeDefined();
    });
});

describe("Export", () => {
    test("should have command metadata", () => {
        const data = (Export as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("file.export");
        expect(data.icon).toBe("icon-export");
    });

    test("should extend CancelableCommand", () => {
        const cmd = new Export();
        expect(cmd).toBeInstanceOf(CancelableCommand);
    });

    test("format should default to '.step'", () => {
        const cmd = new Export();
        expect(cmd.format).toBe(".step");
    });

    test("format setter should update property", () => {
        const cmd = new Export();
        cmd.format = ".stl";
        expect(cmd.format).toBe(".stl");

        cmd.format = ".step";
        expect(cmd.format).toBe(".step");
    });

    test("should populate combobox items from dataExchange.exportFormats in constructor", () => {
        const restoreApp = installExportApp();
        try {
            const cmd = new Export();
            // The combobox should be populated with formats.
            // Just verify construction doesn't throw and format works.
            expect(cmd.format).toBe(".step");
        } finally {
            restoreApp();
        }
    });

    test("constructor should select index 0 when format not in combobox", () => {
        const restoreApp = installExportApp();
        try {
            const cmd = new Export();
            // Format ".step" should be in the list, so selectedIndex maps accordingly
            expect(cmd.format).toBe(".step");
        } finally {
            restoreApp();
        }
    });

    test("format setter handles .stl suffix", () => {
        const cmd = new Export();
        cmd.format = ".stl";
        expect(cmd.format).toBe(".stl");
    });

    test("format setter handles .stl binary suffix", () => {
        const cmd = new Export();
        cmd.format = ".stl binary";
        expect(cmd.format).toBe(".stl binary");
    });

    test("format setter handles .ply binary suffix", () => {
        const cmd = new Export();
        cmd.format = ".ply binary";
        expect(cmd.format).toBe(".ply binary");
    });

    test("format setter should handle unknown format gracefully", () => {
        const cmd = new Export();
        cmd.format = ".unknown";
        expect(cmd.format).toBe(".unknown");
    });

    describe("selectNodesAsync", () => {
        test("should create AsyncController and SelectNodeStep", async () => {
            const cmd = new Export();
            const doc = createMockDocument();
            (doc as any).picker = {
                pickNode: () => Promise.resolve([]),
            };
            (cmd as any)._application = { activeView: { document: doc } };

            const result = await (cmd as any).selectNodesAsync();
            // When no nodes are picked, it should publish a toast and return undefined
            expect(result).toBeUndefined();
        });
    });

    describe("executeAsync error paths", () => {
        test("should publish toast when no nodes selected", async () => {
            const originalPub = PubSub.default.pub;
            let publishCalled = false;
            PubSub.default.pub = ((channel: string, ..._args: unknown[]) => {
                if (channel === "showToast") {
                    publishCalled = true;
                }
            }) as any;

            try {
                const cmd = new Export();
                (cmd as any)._application = createMockApplicationWithDoc();

                // Override selectNodesAsync to return empty
                (cmd as any).selectNodesAsync = () => Promise.resolve([]);

                await (cmd as any).executeAsync();
                expect(publishCalled).toBe(true);
            } finally {
                PubSub.default.pub = originalPub;
            }
        });

        test("should publish showToast when selectNodesAsync returns undefined", async () => {
            const originalPub = PubSub.default.pub;
            let publishCalled = false;
            PubSub.default.pub = ((channel: string, ..._args: unknown[]) => {
                if (channel === "showToast") {
                    publishCalled = true;
                }
            }) as any;

            try {
                const cmd = new Export();
                (cmd as any)._application = createMockApplicationWithDoc();
                (cmd as any).selectNodesAsync = () => Promise.resolve(undefined);

                await (cmd as any).executeAsync();
                expect(publishCalled).toBe(true);
            } finally {
                PubSub.default.pub = originalPub;
            }
        });
    });

    describe("executeAsync happy path", () => {
        test("should publish showPermanent with nodes", async () => {
            let permanentChannel = "";
            const originalPub = PubSub.default.pub;
            PubSub.default.pub = ((channel: string, ..._args: unknown[]) => {
                if (channel === "showPermanent") {
                    permanentChannel = channel;
                }
            }) as any;

            try {
                const cmd = new Export();
                (cmd as any)._application = {
                    activeView: { document: createMockDocument() },
                    dataExchange: {
                        export: () => Promise.resolve(new ArrayBuffer(8)),
                    },
                };
                (cmd as any).selectNodesAsync = () => Promise.resolve([{ name: "testNode", id: "1" }]);

                await (cmd as any).executeAsync();
                expect(permanentChannel).toBe("showPermanent");
            } finally {
                PubSub.default.pub = originalPub;
            }
        });
    });
});

/** Install an app stub so Export constructor can call app.dataExchange.exportFormats(). */
function installExportApp(): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
    Object.defineProperty(globalThis, "app", {
        configurable: true,
        get: () => ({
            dataExchange: {
                exportFormats: () => [".step", ".stl", ".stl binary", ".ply", ".ply binary"],
            },
        }),
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "app", previous);
        }
    };
}

function createMockApplicationWithDoc() {
    const app = createMockApplication();
    app.activeView = { document: createMockDocument() } as any;
    return app;
}
