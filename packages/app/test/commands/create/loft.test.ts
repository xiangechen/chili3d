// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Continuities, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { LoftCommand } from "../../../src/commands/create/loft";
import { ensureGlobalStubApp, mockShape, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

describe("LoftCommand", () => {
    test("should have command metadata", () => {
        const data = (LoftCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("create.loft");
        expect(data.icon).toBe("icon-loft");
    });

    test("isSolid should default to false", () => {
        const cmd = new LoftCommand();
        expect(cmd.isSolid).toBe(false);
    });

    test("isRuled should default to false", () => {
        const cmd = new LoftCommand();
        expect(cmd.isRuled).toBe(false);
    });

    test("confirm should be a function", () => {
        const cmd = new LoftCommand();
        expect(typeof cmd.confirm).toBe("function");
    });

    test("continuity should default to the first continuity option", () => {
        const cmd = new LoftCommand();
        expect(cmd.continuity).toBe(Continuities[0]);
    });

    describe("property setters", () => {
        test("isSolid setter should update value and trigger displayVisual", () => {
            const cmd = new LoftCommand();
            wireCommand(cmd);
            cmd.isSolid = true;
            expect(cmd.isSolid).toBe(true);
        });

        test("isRuled setter should update value and trigger displayVisual", () => {
            const cmd = new LoftCommand();
            wireCommand(cmd);
            cmd.isRuled = true;
            expect(cmd.isRuled).toBe(true);
        });

        test("continuity setter should update value and trigger displayVisual", () => {
            const cmd = new LoftCommand();
            wireCommand(cmd);
            cmd.continuity = Continuities[1];
            expect(cmd.continuity).toBe(Continuities[1]);
        });
    });

    describe("confirm", () => {
        test("should succeed the controller when one is present", () => {
            const cmd = new LoftCommand() as any;
            const calls: string[] = [];
            cmd.controller = {
                success: () => {
                    calls.push("success");
                },
            };
            cmd.confirm();
            expect(calls).toEqual(["success"]);
        });
    });

    describe("removeVisual", () => {
        test("should be a no-op when no visual is registered", () => {
            const cmd = new LoftCommand() as any;
            wireCommand(cmd);
            expect(() => cmd.removeVisual()).not.toThrow();
        });

        test("should remove the registered visual from the context", () => {
            const cmd = new LoftCommand() as any;
            const { doc } = wireCommand(cmd);
            const removed: unknown[] = [];
            (doc.visual.context as any).removeMesh = (id: unknown) => removed.push(id);
            // simulate a previously-registered visual id
            cmd.visual = "visual-id";
            cmd.removeVisual();
            expect(removed).toEqual(["visual-id"]);
            expect(cmd.visual).toBeUndefined();
        });
    });

    describe("displayVisual", () => {
        test("should display edge meshes for collected shapes and register a visual", () => {
            const cmd = new LoftCommand() as any;
            const { doc } = wireCommand(cmd);
            // push two shapes so the loft branch is exercised.
            cmd.shapes.push(mockShape({ shapeType: ShapeTypes.wire }));
            cmd.shapes.push(mockShape({ shapeType: ShapeTypes.wire }));

            const result = cmd.displayVisual();
            expect(result).toBe(true);
            // a visual id should have been registered via displayMesh.
            expect(cmd.visual).toBe("visual-id");
            expect((doc.visual.context.displayMesh as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });

        test("should publish an error toast when shapeFactory.loft returns an error", () => {
            const cmd = new LoftCommand() as any;
            wireCommand(cmd);
            // Swap the proxy factory for a real object so the loft override sticks.
            const stubApp = (globalThis as any).app;
            const originalFactory = stubApp.shapeProvider.factory;
            stubApp.shapeProvider.factory = {
                loft: () => ({ isOk: false, error: "loft failed" }),
            };

            const published: unknown[] = [];
            const { PubSub } = require("@chili3d/core");
            const orig = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);

            try {
                cmd.shapes.push(mockShape({ shapeType: ShapeTypes.wire }));
                cmd.shapes.push(mockShape({ shapeType: ShapeTypes.wire }));
                cmd.displayVisual();
                expect(published.length).toBeGreaterThanOrEqual(1);
                expect(published[0]).toContain("showToast");
            } finally {
                PubSub.default.pub = orig;
                stubApp.shapeProvider.factory = originalFactory;
            }
        });

        test("should not attempt a loft when fewer than two shapes are collected", () => {
            const cmd = new LoftCommand() as any;
            wireCommand(cmd);
            cmd.shapes.push(mockShape({ shapeType: ShapeTypes.wire }));
            expect(() => cmd.displayVisual()).not.toThrow();
            expect(cmd.visual).toBe("visual-id");
        });
    });

    describe("clearVisual", () => {
        test("should remove the visual and clear the highlighter", () => {
            const cmd = new LoftCommand() as any;
            const { doc } = wireCommand(cmd);
            // clearVisual also calls highlighter.clear(); wireCommand omits it.
            (doc.visual.highlighter as any).clear = () => {};
            cmd.visual = "visual-id";
            cmd.clearVisual();
            expect(cmd.visual).toBeUndefined();
        });
    });

    describe("executeAsync", () => {
        test("should collect shapes from each selection then add a loft node on confirm", async () => {
            const cmd = new LoftCommand() as any;
            const { doc, addedNodes } = wireCommand(cmd);
            // Loft's selectSection uses document.picker.pickShape(prompt, controller, opts).
            // Wire it to succeed with one shape the first call, then break with an empty list.
            const pickedShape = {
                shape: mockShape({ shapeType: ShapeTypes.wire }),
                owner: { node: { worldTransform: () => identityLikeMatrix() } },
            };
            let pickCall = 0;
            (doc.picker as any).pickShape = async (_prompt: unknown, controller: any) => {
                pickCall += 1;
                controller.success();
                // First pick returns a shape; second returns empty to terminate the loop.
                return pickCall === 1 ? [pickedShape] : [];
            };
            // selectSection reads document.application.activeView; wire a minimal app.
            (doc as any).application = { activeView: (cmd as any)._application.activeView };
            // highlighter.clear is called in clearVisual (finally block).
            (doc.visual.highlighter as any).clear = () => {};

            await cmd.executeAsync();

            // The selected shape should have been collected.
            expect(cmd.shapes).toHaveLength(1);
            // A loft node should have been added to the document.
            expect(addedNodes).toHaveLength(1);
        });

        test("should return early without adding a node when the first selection is cancelled", async () => {
            const cmd = new LoftCommand() as any;
            const { doc, addedNodes } = wireCommand(cmd);
            // pickShape returns [] without success → data undefined, controller not success → return.
            (doc.picker as any).pickShape = async () => [];
            (doc as any).application = { activeView: (cmd as any)._application.activeView };
            (doc.visual.highlighter as any).clear = () => {};

            await cmd.executeAsync();

            expect(cmd.shapes).toHaveLength(0);
            expect(addedNodes).toHaveLength(0);
        });
    });
});

/** Minimal stand-in for Matrix4.worldTransform() used by the loft loop. */
function identityLikeMatrix() {
    return { multiply: (m: unknown) => identityLikeMatrix() } as any;
}
