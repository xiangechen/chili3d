// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    History,
    type IApplication,
    InternalClassName,
    ModelManager,
    ObservableCollection,
} from "@chili3d/core";
import { createMockApplication } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { Document } from "../src/document";

describe("Document", () => {
    let mockApp: IApplication;
    let document: Document;

    beforeEach(() => {
        mockApp = createMockApplication();
        document = new Document(mockApp, "test-document");
    });

    afterEach(() => {
        document.dispose();
    });

    describe("constructor", () => {
        test("should create document with given name", () => {
            expect(document.name).toBe("test-document");
        });

        test("should generate unique id by default", () => {
            const doc2 = new Document(mockApp, "doc2");
            expect(document.id).not.toBe(doc2.id);
            doc2.dispose();
        });

        test("should use provided id", () => {
            const customId = "custom-document-id";
            const doc = new Document(mockApp, "doc", customId);
            expect(doc.id).toBe(customId);
            doc.dispose();
        });

        test("should add document to application documents", () => {
            expect(mockApp.documents.has(document)).toBe(true);
        });

        test("should initialize modelManager", () => {
            expect(document.modelManager).toBeInstanceOf(ModelManager);
        });

        test("should initialize history", () => {
            expect(document.history).toBeInstanceOf(History);
        });

        test("should initialize acts collection", () => {
            expect(document.acts).toBeInstanceOf(ObservableCollection);
            expect(document.acts.length).toBe(0);
        });

        test("should initialize visual", () => {
            expect(document.visual).toBeDefined();
        });

        test("should initialize selection", () => {
            expect(document.selection).toBeDefined();
        });
    });

    describe("name property", () => {
        test("should get name correctly", () => {
            expect(document.name).toBe("test-document");
        });

        test("should set name correctly", () => {
            document.name = "new-name";
            expect(document.name).toBe("new-name");
        });

        test("should not trigger update if name is same", () => {
            const originalName = document.name;
            document.name = originalName;
            expect(document.name).toBe(originalName);
        });
    });

    describe("serialize", () => {
        test("should serialize document correctly", () => {
            const serialized = document.serialize();

            expect(serialized[InternalClassName]).toBe("Document");
            expect(serialized["id"]).toBe(document.id);
            expect(serialized["name"]).toBe(document.name);
            expect(serialized["models"]).toBeDefined();
            expect(serialized["acts"]).toEqual([]);
            expect(serialized["userData"]).toBeDefined();
        });

        test("should include userData in serialization", () => {
            document.userData = { key: "value" };
            const serialized = document.serialize();

            expect(serialized["userData"]).toEqual({ key: "value" });
        });
    });

    describe("save", () => {
        test("should save document to storage", async () => {
            let saved = false;
            const originalPut = mockApp.storage.put;
            mockApp.storage.put = async () => {
                saved = true;
                return true;
            };
            await document.save();
            expect(saved).toBe(true);
            mockApp.storage.put = originalPut;
        });
    });

    describe("open", () => {
        test("should return undefined for non-existent document", async () => {
            mockApp.storage.get = async () => undefined;

            const openedDoc = await Document.open(mockApp, "non-existent");

            expect(openedDoc).toBeUndefined();
        });
    });

    describe("userData", () => {
        test("should allow setting userData", () => {
            document.userData["foo"] = "bar";
            expect(document.userData["foo"]).toBe("bar");
        });

        test("should preserve userData after serialize", () => {
            document.userData = { test: "data" };
            const serialized = document.serialize();
            expect(serialized["userData"]).toEqual({ test: "data" });
        });
    });

    describe("variables", () => {
        test("starts empty", () => {
            expect(document.variables.items).toEqual([]);
        });

        test("should include variables in serialization", () => {
            document.variables.setItems([{ id: "v1", name: "w", expression: "50", type: "length" }]);

            const serialized = document.serialize();

            expect(serialized["variables"]).toEqual([
                { id: "v1", name: "w", expression: "50", type: "length" },
            ]);
        });

        test("should restore variables through Document.load", async () => {
            document.variables.setItems([
                { id: "v1", name: "w", expression: "50", type: "length", description: "总宽" },
            ]);
            const serialized = document.serialize();

            const loaded = await Document.load(mockApp, serialized);

            try {
                expect(loaded).not.toBeUndefined();
                expect(loaded!.variables.items).toEqual([
                    { id: "v1", name: "w", expression: "50", type: "length", description: "总宽" },
                ]);
                // Restored BEFORE the models deserialize, so a body rebuilding during
                // that load already resolves its parameters.
                expect(loaded!.variables.evaluate().scope.get("w")?.value).toBe(50);
            } finally {
                loaded?.dispose();
            }
        });
    });

    describe("serialize → deserialize roundtrip", () => {
        test("should restore id, name and userData through Document.load", async () => {
            document.userData = { layer: "roundtrip", count: 3 };
            const serialized = document.serialize();

            const loaded = await Document.load(mockApp, serialized);

            try {
                expect(loaded).not.toBeUndefined();
                expect(loaded!.id).toBe(document.id);
                expect(loaded!.name).toBe(document.name);
                expect(loaded!.userData).toEqual({ layer: "roundtrip", count: 3 });
                // The loaded document is registered on the application
                expect(mockApp.documents.has(loaded!)).toBe(true);
            } finally {
                loaded?.dispose();
            }
        });

        test("should restore the model tree root through Document.load", async () => {
            const serialized = document.serialize();

            const loaded = (await Document.load(mockApp, serialized)) as Document;

            try {
                expect(loaded.modelManager.rootNode.name).toBe(document.modelManager.rootNode.name);
                expect(loaded.acts.length).toBe(0);
                // History is re-enabled after loading
                expect(loaded.history.disabled).toBe(false);
            } finally {
                loaded.dispose();
            }
        });
    });

    describe("dispose", () => {
        test("should dispose modelManager, visual, history and selection", () => {
            const modelManagerSpy = rs.spyOn(document.modelManager, "dispose");
            const visualSpy = rs.spyOn(document.visual, "dispose");
            const historySpy = rs.spyOn(document.history, "dispose");
            const selectionSpy = rs.spyOn(document.selection, "dispose");

            document.dispose();

            expect(modelManagerSpy).toHaveBeenCalledTimes(1);
            expect(visualSpy).toHaveBeenCalledTimes(1);
            expect(historySpy).toHaveBeenCalledTimes(1);
            expect(selectionSpy).toHaveBeenCalledTimes(1);
        });

        test("should dispose all acts and clear the acts collection", () => {
            const actDispose = rs.fn();
            document.acts.push({ dispose: actDispose } as any);
            expect(document.acts.length).toBe(1);

            document.dispose();

            expect(actDispose).toHaveBeenCalledTimes(1);
            expect(document.acts.length).toBe(0);
        });
    });
});
