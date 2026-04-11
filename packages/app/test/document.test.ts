// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    History,
    type IApplication,
    type IDataExchange,
    type IDocument,
    InternalClassName,
    type IPluginManager,
    type IShapeFactory,
    type IStorage,
    type IView,
    type IVisual,
    type IVisualFactory,
    ModelManager,
    ObservableCollection,
} from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { Document } from "../src/document";

const createMockApplication = (): IApplication => {
    const mockDocuments = new Set<IDocument>();
    const mockViews = new ObservableCollection<IView>();

    return {
        storage: {
            createDBIfNeeded: async () => {},
            get: async () => undefined,
            put: async () => true,
            delete: async () => true,
            page: async () => [],
        } as IStorage,
        visualFactory: {
            kernelName: "mock",
            create: (doc: IDocument) =>
                ({
                    document: doc,
                    context: {
                        dispose: () => {},
                        removeNode: () => {},
                        redrawNode: () => {},
                        getVisual: () => undefined,
                        setVisible: () => {},
                    },
                    viewHandler: {} as any,
                    highlighter: {
                        addState: () => {},
                        removeState: () => {},
                        getState: () => undefined,
                        clear: () => {},
                        resetState: () => {},
                        highlightMesh: () => 0,
                        removeHighlightMesh: () => {},
                    },
                    meshExporter: {
                        exportToStl: async () => ({ ok: false }),
                        exportToPly: async () => ({ ok: false }),
                        exportToObj: async () => ({ ok: false }),
                    },
                    update: () => {},
                    eventHandler: {} as any,
                    resetEventHandler: () => {},
                    isExcutingHandler: () => false,
                    createView: () => ({}) as IView,
                    dispose: () => {},
                }) as unknown as IVisual,
        } as unknown as IVisualFactory,
        shapeFactory: {} as IShapeFactory,
        dataExchange: {} as IDataExchange,
        services: [],
        pluginManager: {} as IPluginManager,
        views: mockViews,
        documents: mockDocuments,
        activeView: undefined,
        executingCommand: undefined,
        dispose: () => {},
        removePropertyChanged: () => {},
        clearPropertyChanged: () => {},
        onPropertyChanged: () => {},
        newDocument: async () => ({}) as IDocument,
        openDocument: async () => undefined,
        loadDocument: async () => undefined,
        loadFileFromUrl: async () => {},
    };
};

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
            expect(document.modelManager).toBeDefined();
            expect(document.modelManager).toBeInstanceOf(ModelManager);
        });

        test("should initialize history", () => {
            expect(document.history).toBeDefined();
            expect(document.history).toBeInstanceOf(History);
        });

        test("should initialize acts collection", () => {
            expect(document.acts).toBeDefined();
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
});
