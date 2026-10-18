// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, CommandStore, Plane, PropertyUtils, Result } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { PlaneCommand } from "../../src/commands/planeCommand";
import { PlaneNode } from "../../src/plane/planeNode";

function command() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    doc.visual = createMockVisualWithDocument(doc) as any;
    doc.selection = {
        getSelectedShapes: () => [],
        getSelectedNodes: () => [],
        setSelectedShapes: rs.fn(),
        setSelectedNodes: rs.fn(),
        clearSelection: () => {},
    } as any;
    const cmd = new PlaneCommand() as any;
    cmd._application = app;
    return { cmd, app, doc };
}

function mockRect() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: { rect: () => Result.ok({ isEqual: () => false }) },
        writable: true,
        configurable: true,
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

describe("PlaneCommand registration", () => {
    test("the ribbon key resolves to the command", () => {
        expect(CommandStore.getCommand("feature.plane")).toBe(PlaneCommand);
    });

    test("the panel shows the type and the parameter rows", () => {
        const names = PropertyUtils.getProperties(new PlaneCommand()).map((x) => x.name);
        expect(names).toEqual(expect.arrayContaining(["planeType", "distance", "reverse", "angle", "flip"]));
    });

    test("the default run creates an offset plane", () => {
        const { cmd } = command();
        cmd._refs = { source: { kind: "datum", name: "XY" }, anchors: {} };

        const definition = cmd.buildDefinition();
        expect(definition.isOk).toBe(true);
        expect(definition.value).toMatchObject({
            kind: "offset",
            source: { kind: "datum", name: "XY" },
            distance: 10,
            reverse: false,
            flip: false,
        });
    });

    test("a typed distance is resolved as a length", () => {
        const { cmd } = command();
        cmd._refs = { source: { kind: "datum", name: "XY" }, anchors: {} };
        cmd.distance = "25";

        const definition = cmd.buildDefinition();
        expect(definition.isOk).toBe(true);
        expect(definition.value.kind === "offset" && definition.value.distance).toBe(25);
    });

    test("three points become a three-point definition", () => {
        const { cmd } = command();
        cmd.setPrivateValue("planeType", "feature.plane.threePoint");
        cmd._refs = {
            points: [
                { nodeId: "b", vertex: { point: { x: 0, y: 0, z: 0 } } },
                { nodeId: "b", vertex: { point: { x: 1, y: 0, z: 0 } } },
                { nodeId: "b", vertex: { point: { x: 0, y: 1, z: 0 } } },
            ],
            anchors: {},
        };

        const definition = cmd.buildDefinition();
        expect(definition.isOk).toBe(true);
        expect(definition.value.kind).toBe("threePoint");
    });

    test("building without refs is an error, not a crash", () => {
        const { cmd } = command();
        expect(cmd.buildDefinition().isOk).toBe(false);
    });

    test("committing adds a plane node and the shared datum material", () => {
        const { cmd, doc } = command();
        const restore = mockRect();
        try {
            cmd._refs = { source: { kind: "datum", name: "XY" }, anchors: {} };
            cmd.distance = 12;

            cmd.executeMainTask();

            const node = doc.modelManager.findNode((candidate) => candidate instanceof PlaneNode) as
                | PlaneNode
                | undefined;
            expect(node).toBeDefined();
            expect(node!.definition.kind === "offset" && node!.definition.distance).toBe(12);
            expect(
                doc.modelManager.materials.find((material) => material.name === "Datum Plane"),
            ).toBeDefined();
        } finally {
            restore();
        }
    });

    test("committing with an unresolved refs set leaves the document alone", () => {
        const { cmd, doc } = command();
        const before = doc.modelManager.rootNode.firstChild;
        cmd.executeMainTask();
        expect(doc.modelManager.rootNode.firstChild).toBe(before);
    });
});

describe("PickPlaneGeometryStep", () => {
    test("the step settles only after the preview is confirmed", async () => {
        const { cmd, doc } = command();
        const stepController = new AsyncController();
        let stepWasSettledDuringPreview = false;
        const picks: unknown[] = [];

        (doc.picker as any) = {
            pickAsync: rs.fn(async (handler: any, _prompt: string, controller: AsyncController) => {
                picks.push(handler);
                if (picks.length === 1) {
                    // The geometry pick: a datum plane.
                    handler.result = { kind: "datum", plane: Plane.XY, name: "XY" };
                    controller.success();
                    return;
                }
                // The preview/confirm phase: the step controller must still be open.
                stepWasSettledDuringPreview = stepController.result !== undefined;
                controller.success();
            }),
        };
        const step = (cmd as any).getSteps()[0];
        const snapped = await step.execute(doc, stepController);

        expect(picks.length).toBe(2);
        expect(stepWasSettledDuringPreview).toBe(false);
        expect(snapped).toBeDefined();
        expect(stepController.result?.status).toBe("success");
        expect(cmd.buildDefinition().isOk).toBe(true);
    });
});
