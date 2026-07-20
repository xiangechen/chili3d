// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type INode, Result } from "@chili3d/core";
import { rs } from "@rstest/core";
import { DefaultDataExchange } from "../src/defaultDataExchange";

describe("DefaultDataExchange", () => {
    let exchange: DefaultDataExchange;

    beforeEach(() => {
        exchange = new DefaultDataExchange();
    });

    describe("importFormats", () => {
        test("should return supported import formats", () => {
            const formats = exchange.importFormats();
            expect(formats).toContain(".step");
            expect(formats).toContain(".stp");
            expect(formats).toContain(".iges");
            expect(formats).toContain(".igs");
            expect(formats).toContain(".brep");
            expect(formats).toContain(".stl");
        });

        test("should return an array of strings", () => {
            const formats = exchange.importFormats();
            expect(Array.isArray(formats)).toBe(true);
            for (const f of formats) {
                expect(typeof f).toBe("string");
            }
        });
    });

    describe("exportFormats", () => {
        test("should return supported export formats", () => {
            const formats = exchange.exportFormats();
            expect(formats).toContain(".step");
            expect(formats).toContain(".iges");
            expect(formats).toContain(".brep");
            expect(formats).toContain(".stl");
            expect(formats).toContain(".stl binary");
            expect(formats).toContain(".ply");
            expect(formats).toContain(".ply binary");
            expect(formats).toContain(".obj");
        });

        test("should return an array of strings", () => {
            const formats = exchange.exportFormats();
            expect(Array.isArray(formats)).toBe(true);
            for (const f of formats) {
                expect(typeof f).toBe("string");
            }
        });
    });

    describe("extensionIs (private)", () => {
        // NOTE: extensionIs does NOT lowercase internally — the caller
        // (handleSingleFileImport) lowercases the fileName before passing it in.
        test("should match exact extension (already lowercased by caller)", () => {
            expect((exchange as any).extensionIs("model.step", ".step")).toBe(true);
        });

        test("should return false for non-matching extension", () => {
            expect((exchange as any).extensionIs("model.stl", ".step")).toBe(false);
        });

        test("should match against multiple extensions", () => {
            expect((exchange as any).extensionIs("model.stp", ".step", ".stp")).toBe(true);
        });

        test("should return false when none match", () => {
            expect((exchange as any).extensionIs("model.obj", ".step", ".iges")).toBe(false);
        });

        test("should match .stl extension", () => {
            expect((exchange as any).extensionIs("model.stl", ".stl")).toBe(true);
        });

        test("should match .brep extension", () => {
            expect((exchange as any).extensionIs("model.brep", ".brep")).toBe(true);
        });
    });

    describe("handleImportResult (private)", () => {
        test("should show alert when nodeResult is undefined", () => {
            const alertSpy = rs.fn();
            const originalAlert = globalThis.alert;
            globalThis.alert = alertSpy;

            (exchange as any).handleImportResult(
                { modelManager: { addNode: rs.fn() }, visual: { update: rs.fn() } },
                "test.step",
                undefined,
            );

            expect(alertSpy).toHaveBeenCalled();
            globalThis.alert = originalAlert;
        });

        test("should show alert when nodeResult is not ok", () => {
            const alertSpy = rs.fn();
            const originalAlert = globalThis.alert;
            globalThis.alert = alertSpy;

            (exchange as any).handleImportResult(
                { modelManager: { addNode: rs.fn() }, visual: { update: rs.fn() } },
                "test.step",
                Result.err("some error"),
            );

            expect(alertSpy).toHaveBeenCalled();
            globalThis.alert = originalAlert;
        });

        test("should add node and set its name on success", () => {
            const addNodeSpy = rs.fn();
            const updateSpy = rs.fn();
            const node = { name: "" } as unknown as INode;
            const doc = {
                modelManager: { addNode: addNodeSpy },
                visual: { update: updateSpy },
            } as unknown as IDocument;

            (exchange as any).handleImportResult(doc, "model.step", Result.ok(node));

            expect(node.name).toBe("model.step");
            expect(addNodeSpy).toHaveBeenCalledWith(node);
            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe("handleExportResult (private)", () => {
        test("should return array with value when result is ok", () => {
            const blobPart = "blob-data";
            const result = (exchange as any).handleExportResult(Result.ok(blobPart));
            expect(result).toEqual([blobPart]);
        });

        test("should return undefined when result is undefined", () => {
            const result = (exchange as any).handleExportResult(undefined);
            expect(result).toBeUndefined();
        });

        test("should return undefined when result is err", () => {
            const result = (exchange as any).handleExportResult(Result.err("error"));
            expect(result).toBeUndefined();
        });
    });

    describe("import", () => {
        test("should handle empty file list", async () => {
            const doc = {
                modelManager: { rootNode: { add: rs.fn() }, addNode: rs.fn() },
                visual: { update: rs.fn() },
            } as unknown as IDocument;
            await expect(exchange.import(doc, [])).resolves.toBeUndefined();
        });
    });

    describe("export", () => {
        test("should return undefined for empty nodes array", async () => {
            const result = await exchange.export(".step", []);
            expect(result).toBeUndefined();
        });
    });
});
