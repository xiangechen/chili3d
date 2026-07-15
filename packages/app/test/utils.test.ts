// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, IView } from "@chili3d/core";
import { PubSub } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { importFiles } from "../src/utils";
import { createMockApplication, createMockDocument } from "./_helpers";

function createMockView(doc: IDocument): IView {
    return {
        document: doc,
        cameraController: { fitContent: () => {} },
    } as unknown as IView;
}

describe("importFiles", () => {
    let newDocumentCalls: string[];

    beforeEach(() => {
        newDocumentCalls = [];
    });

    afterEach(() => {
        PubSub.default.removeAll("showPermanent");
    });

    describe("document resolution", () => {
        test("should use existing activeView document (does not call newDocument)", async () => {
            const doc = createMockDocument({ id: "existing", name: "existing" });
            const view = createMockView(doc);

            const app = createMockApplication({
                dataExchange: { import: async () => {} },
            });
            app.activeView = view;
            app.newDocument = async () => {
                newDocumentCalls.push("unexpected");
                return {} as IDocument;
            };

            await importFiles(app, [new File([], "test.step")]);

            expect(newDocumentCalls.length).toBe(0);
        });

        test("should create new Untitled document when no activeView", async () => {
            const app = createMockApplication({
                dataExchange: {
                    import: async (_document: IDocument, _files: File[] | FileList) => {},
                },
            });
            app.activeView = undefined;
            app.newDocument = async (name: string) => {
                newDocumentCalls.push(name);
                const newDoc = createMockDocument({ id: "new-doc", name, application: app });
                const newView = createMockView(newDoc);
                app.activeView = newView;
                return newDoc;
            };

            await importFiles(app, [new File([], "test.igs")]);

            expect(newDocumentCalls).toEqual(["Untitled"]);
        });

        test("should create new document when activeView is undefined", async () => {
            const app = createMockApplication({
                dataExchange: { import: async () => {} },
            });
            app.activeView = undefined;
            app.newDocument = async (name: string) => {
                newDocumentCalls.push(name);
                const newDoc = createMockDocument({ id: "fallback-doc", name, application: app });
                const newView = createMockView(newDoc);
                app.activeView = newView;
                return newDoc;
            };

            await importFiles(app, [new File([], "model.stl")]);

            expect(newDocumentCalls).toEqual(["Untitled"]);
        });
    });

    describe("PubSub event", () => {
        test("should publish showPermanent with correct message key", async () => {
            const doc = createMockDocument({ id: "test-doc", name: "test-doc" });
            const view = createMockView(doc);

            let capturedCallback: unknown;
            let capturedMessage: unknown;

            const originalPub = PubSub.default.pub.bind(PubSub.default);
            PubSub.default.pub = ((event: string, ...args: unknown[]) => {
                if (event === "showPermanent") {
                    capturedCallback = args[0];
                    capturedMessage = args[1];
                }
            }) as typeof PubSub.default.pub;

            const app = createMockApplication({
                dataExchange: { import: async () => {} },
            });
            app.activeView = view;
            app.newDocument = async () => ({}) as IDocument;

            await importFiles(app, [new File([], "test.stl")]);

            expect(capturedMessage).toBe("toast.excuting{0}");
            expect(typeof capturedCallback).toBe("function");

            // Restore pub
            PubSub.default.pub = originalPub;
        });
    });

    describe("dataExchange integration", () => {
        test("should call dataExchange.import when the published callback is executed", async () => {
            let capturedCallback: (() => Promise<void>) | undefined;
            const originalPub = PubSub.default.pub.bind(PubSub.default);
            PubSub.default.pub = ((event: string, ...args: unknown[]) => {
                if (event === "showPermanent") {
                    capturedCallback = args[0] as () => Promise<void>;
                }
            }) as typeof PubSub.default.pub;

            let fitContentCalled = false;
            let importCalled = false;
            let importFilesArg: File[] | FileList | undefined;

            const app = createMockApplication({
                dataExchange: {
                    import: async (_document: IDocument, files: File[] | FileList) => {
                        importCalled = true;
                        importFilesArg = files;
                    },
                },
            });
            app.newDocument = async () => ({}) as IDocument;

            const doc = createMockDocument({ id: "import-doc", name: "import-doc", application: app });
            const view = createMockView(doc);
            (view as any).cameraController = {
                fitContent: () => {
                    fitContentCalled = true;
                },
            };
            app.activeView = view;

            const files = [new File([], "model.brep")];
            await importFiles(app, files);

            expect(capturedCallback).toBeDefined();
            await capturedCallback!();

            expect(importCalled).toBe(true);
            expect(importFilesArg).toBe(files);
            expect(fitContentCalled).toBe(true);

            PubSub.default.pub = originalPub;
        });
    });
});
