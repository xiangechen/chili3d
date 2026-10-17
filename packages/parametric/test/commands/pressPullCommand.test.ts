// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    CancelableCommand,
    CommandStore,
    type IApplication,
    type ICommand,
    Matrix4,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockShape, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../../src/commands"; // registers every command, the hand-off targets included
import { PressPullCommand } from "../../src/commands/pressPullCommand";
import { PressPullHandler } from "../../src/commands/pressPullStep";
import type { FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

const data = (node: unknown, shapeType: ShapeType, index = 0) =>
    ({
        shape: {
            shapeType,
            isSame: () => false,
            dispose: () => {},
            // Read when the pick is a chamfer's flat: a surface is what says whether the drag has
            // ONE plane to parallel, and a mock that cannot answer one answers "not planar".
            surface: () => ({ isPlanar: () => false }),
        },
        owner: { node },
        transform: Matrix4.identity(),
        indexes: [index],
        point: XYZ.zero,
        boundingBox: () => BoundingBox.zero,
    }) as any;

describe("PressPullCommand registration", () => {
    test("the key the ribbon and Q name resolves to the command", () => {
        expect(CommandStore.getCommand("feature.pressPull")).toBe(PressPullCommand);
    });

    test("every command it can hand off to is really registered", () => {
        // A typo in a target key is Press Pull's one silent failure: the tile and the key would do
        // nothing at all, with no error anywhere (the dispatcher returns on an unknown key).
        for (const key of [
            "feature.extrude",
            "feature.offsetFace",
            "feature.fillet",
            "feature.chamfer",
            "feature.modifyFillet",
            "feature.modifyChamfer",
        ]) {
            expect(CommandStore.getCommand(key)).toBeDefined();
        }
    });

    test("it opens with a 2 mm distance", () => {
        expect(new PressPullCommand().distance).toBe(2);
    });
});

describe("PressPullCommand hand-off", () => {
    // The command Press Pull opens, standing in for the real one. It records on module state:
    // `CommandStore.getCommand` hands back a CONSTRUCTOR, so what runs is a fresh instance.
    let runs = 0;
    let seenExecuting: unknown[] = [];
    let seenSettled: (boolean | undefined)[] = [];
    class Target implements ICommand {
        pickSettled?: boolean;
        async execute(application: IApplication): Promise<void> {
            runs++;
            seenExecuting.push(application.executingCommand);
            seenSettled.push(this.pickSettled);
        }
    }

    let getCommand: ReturnType<typeof rs.spyOn>;
    let seed: ReturnType<typeof rs.spyOn>;
    beforeEach(() => {
        runs = 0;
        seenExecuting = [];
        seenSettled = [];
        getCommand = rs.spyOn(CommandStore, "getCommand").mockReturnValue(Target);
        // Spied but NOT stubbed: the command under test has to reach the real cache.
        seed = rs.spyOn(CancelableCommand, "seedOptions");
    });
    afterEach(() => {
        getCommand.mockRestore();
        seed.mockRestore();
    });

    /**
     * A command whose pick and distance are already settled — what `PressPullStep` hands it. The
     * gesture itself (what is picked, and how) is `pressPullStep.test.ts`.
     */
    function settled(shapes: any[], distance: number) {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.selection = {
            getSelectedShapes: () => [],
            getSelectedNodes: () => [],
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
        const cmd = new PressPullCommand();
        (cmd as any)._application = app;
        (cmd as any).stepDatas = [{ shapes, nodes: [shapes[0]?.owner.node], type: "input", distance }];
        return { cmd, app, doc };
    }

    const body = () =>
        new ParametricBodyNode({
            document: new TestDocument({ application: createMockApplication() }),
            features: [],
        });

    /** A body whose face tracking answers for the one corner face the pick names. */
    function cornerBody(feature: FeatureData, faceId: string): ParametricBodyNode {
        const owner = new ParametricBodyNode({
            document: new TestDocument({ application: createMockApplication() }),
            id: "b1",
            features: [feature],
        });
        owner.hasTrackedIds = () => true;
        owner.faceIdAt = () => faceId;
        // What the corner check asks of a body is only whether it HAS a shape; building one for real
        // takes the kernel. Set after the features so nothing rebuilds over it.
        owner.shape = Result.ok(createMockShape());
        return owner;
    }

    test("a face a fillet built opens the modify command, the drag its extra radius", async () => {
        const owner = cornerBody({ id: "f1", type: "fillet", radius: 3, edges: [] }, "f1:e9:f");
        const { cmd } = settled([data(owner, ShapeTypes.face)], 4);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.modifyFillet");
        // A round is a cylinder about its own axis, so moving its surface out by the drag is
        // exactly that much radius — and the pick this gesture made answers the command's own.
        expect(seed).toHaveBeenCalledWith("feature.modifyFillet", { value: 7 });
        expect(seenSettled).toEqual([true]);
    });

    test("a face a chamfer built opens the modify command with no size invented", async () => {
        const owner = cornerBody({ id: "c1", type: "chamfer", distance: 2, edges: [] }, "c1:e9:f");
        const { cmd } = settled([data(owner, ShapeTypes.face)], 4);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.modifyChamfer");
        // The drag could not be read as a chamfer distance — here because the mock's face answers
        // to no plane, and in the field because an asymmetric chamfer's flat is fixed by both of
        // its parameters at once (see `cornerDragOf`) — so the command opens on its own distance,
        // with its pick live for the user to set. THAT path is two confirms by construction; the
        // one where the geometry does answer is `modifyCorner.kernel.test.ts`.
        expect(seed).not.toHaveBeenCalled();
        expect(seenSettled).toEqual([false]);
    });

    test("a body's face opens the offset command with the distance it was given", async () => {
        const owner = body();
        const { cmd, doc } = settled([data(owner, ShapeTypes.face)], 4);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.offsetFace");
        expect(seed).toHaveBeenCalledWith("feature.offsetFace", { distance: 4 });
        expect(runs).toBe(1);
        // The whole pick is put back so the offset command's own step preselects it.
        expect((doc.selection.setSelectedShapes as any).mock.calls.at(-1)![0]).toHaveLength(1);
    });

    test("a negative distance on a face passes straight through, so the face moves in", async () => {
        const { cmd } = settled([data(body(), ShapeTypes.face)], -4);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.offsetFace");
        expect(seed).toHaveBeenCalledWith("feature.offsetFace", { distance: -4 });
    });

    test("several faces of one body go over together, with the one distance", async () => {
        const owner = body();
        const { cmd, doc } = settled([data(owner, ShapeTypes.face, 0), data(owner, ShapeTypes.face, 1)], 4);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.offsetFace");
        // The WHOLE set is handed on: the offset command's own step is a multi pick too.
        expect((doc.selection.setSelectedShapes as any).mock.calls.at(-1)![0]).toHaveLength(2);
    });

    test("an edge out is a round, the distance its radius", async () => {
        const { cmd } = settled([data(body(), ShapeTypes.edge)], 3);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.fillet");
        expect(seed).toHaveBeenCalledWith("feature.fillet", { value: 3 });
    });

    test("an edge in is a chamfer, the distance its length", async () => {
        const { cmd } = settled([data(body(), ShapeTypes.edge)], -3);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.chamfer");
        // The size is the MAGNITUDE: a chamfer's length is not negative, the sign was the choice.
        expect(seed).toHaveBeenCalledWith("feature.chamfer", { value: 3 });
    });

    test("a sketch's face is extruded by the distance it was dragged", async () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        const { cmd } = settled([data(sketch, ShapeTypes.face)], 2);

        await (cmd as any).openFromPick();

        expect(getCommand).toHaveBeenCalledWith("feature.extrude");
        // The profile is what was dragged, so the distance is the prism's depth: one gesture, where
        // handing nothing over made the user drag the same depth a second time inside Extrude.
        expect(seed).toHaveBeenCalledWith("feature.extrude", { depth: 2 });
        expect(seenSettled).toEqual([true]);
    });

    test("the app is told the TARGET is executing, so its cancel paths reach it", async () => {
        const { cmd, app } = settled([data(body(), ShapeTypes.edge)], 3);

        await (cmd as any).openFromPick();

        expect(seenExecuting).toHaveLength(1);
        expect(seenExecuting[0]).toBeInstanceOf(Target);
        expect(app.executingCommand).toBeUndefined();
    });
});

describe("PressPullCommand panel entry", () => {
    /**
     * The options tab and the arrow are two views of ONE value: the drag writes the panel
     * (`onValue`), and the panel has to write the drag back. With only the first half, a distance
     * typed in instead of dragged is dropped — the gesture still holds what it started at, and
     * that is what the operation is handed.
     */
    test("a distance typed into the panel reaches the live arrow", () => {
        const doc = new TestDocument({ application: createMockApplication() });
        const cmd = new PressPullCommand();
        const handler = new PressPullHandler(doc, new AsyncController(), 2, () => {});
        (cmd as any).onArrowReady(handler);

        cmd.distance = 20;

        expect(handler.value).toBe(20);

        (cmd as any).onArrowDone();
        handler.dispose();
    });
});

describe("PressPullCommand preselection", () => {
    test("a selected sketch node is extruded without any gesture of ours", async () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        doc.selection = {
            getSelectedShapes: () => [],
            getSelectedNodes: () => [sketch],
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
        const pickAsync = rs.fn(() => Promise.resolve());
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([])), pickAsync } as any;
        const getCommand = rs.spyOn(CommandStore, "getCommand").mockReturnValue(
            class implements ICommand {
                async execute(): Promise<void> {}
            },
        );
        try {
            await new PressPullCommand().execute(app);

            expect(getCommand).toHaveBeenCalledWith("feature.extrude");
            expect(pickAsync).not.toHaveBeenCalled();
        } finally {
            getCommand.mockRestore();
        }
    });
});
