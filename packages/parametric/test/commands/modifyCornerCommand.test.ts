// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    Matrix4,
    PropertyUtils,
    PubSub,
    Result,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
    XY,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockShape,
    createMockVisualWithDocument,
    MockShape,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    cornerFeatureOf,
    ModifyChamferFeatureCommand,
    ModifyFilletFeatureCommand,
} from "../../src/commands/modifyCornerCommand";
import type { EdgeRef } from "../../src/features/edgeRef";
import type { ChamferFeatureData, FeatureData, FilletFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

const fillet = (id: string, radius: number = 2, radius2?: number): FilletFeatureData => ({
    id,
    type: "fillet",
    radius,
    edges: [],
    ...(radius2 === undefined ? {} : { radius2 }),
});

const chamfer = (id: string, distance: number = 1, distance2?: number): ChamferFeatureData => ({
    id,
    type: "chamfer",
    distance,
    edges: [],
    ...(distance2 === undefined ? {} : { mode: "twoDistance" as const, distance2 }),
});

/**
 * A stand-in for a body, answering only what `cornerFeatureOf` asks of one. The real answers come
 * from the timeline a kernel run builds (`BodyTimeline.idAt`), which the kernel test next door
 * exercises against real ids; what is under test here is what the prefix test makes of them.
 */
function trackingBody(
    features: FeatureData[],
    faceIds: readonly (string | undefined)[],
    tracks: boolean = true,
): ParametricBodyNode {
    return {
        features,
        hasTrackedIds: (kind: string) => tracks && kind === "face",
        faceIdAt: (index: number) => faceIds[index],
    } as unknown as ParametricBodyNode;
}

describe("cornerFeatureOf", () => {
    test("a face is attributed to the feature whose id names it", () => {
        const body = trackingBody([fillet("f1")], ["f1:sketch:sk1:e1.2.3.4:ent1:f"]);

        expect(cornerFeatureOf(body, 0)?.id).toBe("f1");
    });

    test("a face merged with a neighbour still answers for the corner that named it", () => {
        // `prefixedId` prefixes every leaf, so a boolean's `combineIds` of the round with a plain
        // face leaves the round's own leaf whole.
        const body = trackingBody([fillet("f1")], ["f1:e9:f|sketch:sk1:e1.2.3.4:ent4"]);

        expect(cornerFeatureOf(body, 0)?.id).toBe("f1");
    });

    test("a round made again on top of another belongs to the later feature", () => {
        // The later corner derived its name from the earlier one's surface, so its own prefix is
        // in front — and the round the user sees is the later one's.
        const body = trackingBody([fillet("f1"), fillet("f2")], ["f2:f1:e9:f:f"]);

        expect(cornerFeatureOf(body, 0)?.id).toBe("f2");
    });

    test("a feature id that is a prefix of another does not claim its faces", () => {
        const body = trackingBody([fillet("f1"), fillet("f10")], ["f10:e9:f"]);

        expect(cornerFeatureOf(body, 0)?.id).toBe("f10");
    });

    test("a face two corners both named is refused rather than guessed", () => {
        const body = trackingBody([fillet("f1"), fillet("f2")], ["f1:e9:f|f2:e7:f"]);

        expect(cornerFeatureOf(body, 0)).toBeUndefined();
    });

    test("a face no corner named has no owner", () => {
        const body = trackingBody([fillet("f1")], ["sketch:sk1:e1.2.3.4:ent1"]);

        expect(cornerFeatureOf(body, 0)).toBeUndefined();
    });

    test("a face id minted by another kind of feature is not a corner's", () => {
        // Shell, thicken, draft and pattern name their faces under their own feature id too, so
        // without the kind filter a shell would answer for a face it never rounded.
        const shell = { id: "s1", type: "shell", thickness: 1, faces: [] } as unknown as FeatureData;
        const body = trackingBody([shell, fillet("f1")], ["s1:e9:offset"]);

        expect(cornerFeatureOf(body, 0)).toBeUndefined();
    });

    test("an unnamed face has no owner", () => {
        const body = trackingBody([fillet("f1")], [undefined]);

        expect(cornerFeatureOf(body, 0)).toBeUndefined();
    });

    test("a body that tracks no face ids has no owners", () => {
        const body = trackingBody([fillet("f1")], ["f1:e9:f"], false);

        expect(cornerFeatureOf(body, 0)).toBeUndefined();
    });
});

/**
 * A picked face as the viewport reports one. It answers the little the arrow asks a face — a
 * transform into world space, a surface that will not place a point, and a normal — because the
 * arrow is drawn from the face the pointer landed on.
 */
const faceData = (node: unknown, index: number = 0): VisualShapeData => {
    const face = {
        shapeType: ShapeTypes.face,
        dispose: () => {},
        transformedMul: () => face,
        surface: () => ({ parameter: () => undefined }),
        normal: () => [XYZ.zero, XYZ.unitZ],
    };
    return {
        shape: face,
        owner: { node },
        transform: Matrix4.identity(),
        indexes: [index],
        point: XYZ.zero,
    } as unknown as VisualShapeData;
};

/** What the document handed back, plus a way to put shapes in the selection a click would. */
function scenario(features: FeatureData[], faceIds: readonly (string | undefined)[]) {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    // The view the arrow scales itself against; a stub is enough, it only has to answer.
    (app as any).activeView = {
        document: doc,
        direction: () => XYZ.unitZ,
        up: () => XYZ.unitY,
        worldToScreen: () => XY.zero,
    };
    doc.visual = createMockVisualWithDocument(doc, {
        highlighter: { addState: rs.fn(), removeState: rs.fn() } as any,
        context: {
            displayMesh: rs.fn(() => 1),
            removeMesh: rs.fn(),
            getVisual: () => undefined,
        } as any,
    });
    const body = new ParametricBodyNode({ document: doc, id: "b1", features });
    body.hasTrackedIds = () => true;
    body.faceIdAt = (index: number) => faceIds[index];
    // The command only asks whether the body HAS a shape — a body whose chain could not build has
    // nothing to pick on. Building one for real takes the kernel, which is the kernel test's job.
    body.shape = Result.ok(createMockShape());
    doc.modelManager.addNode(body);

    let selected: VisualShapeData[] = [];
    const listeners: ((shapes: VisualShapeData[]) => void)[] = [];
    const publish = () => {
        for (const listener of listeners) listener([...selected]);
    };
    // Writes publish, the way the real manager's do — the command learns what it is editing from
    // exactly these events, a step's seeding of the selection included.
    doc.selection = {
        getSelectedShapes: () => selected,
        getSelectedNodes: () => [body],
        setSelectedShapes: rs.fn((shapes: VisualShapeData[]) => {
            selected = shapes;
            publish();
        }),
        setSelectedNodes: rs.fn(),
        clearSelection: () => {
            selected = [];
            publish();
        },
        onShapeChanged: { sub: (fn: any) => listeners.push(fn), remove: () => {} },
    } as any;

    return { app, doc, body, select: (picked: VisualShapeData[]) => (selected = picked) };
}

/** Runs the pick the way a click does, so the command holds the face it just resolved. */
function pick(
    command: ModifyFilletFeatureCommand | ModifyChamferFeatureCommand,
    app: unknown,
    selection: (picked: VisualShapeData[]) => void,
    picked: VisualShapeData,
) {
    (command as any)._application = app;
    selection([picked]);
    (command as any).onSelectionChanged();
    return command;
}

describe("modify corner command registration", () => {
    test("the keys the ribbon names resolve to the commands", () => {
        // A ribbon item whose key is not registered renders no button at all — silently.
        expect(CommandStore.getCommand("feature.modifyFillet")).toBe(ModifyFilletFeatureCommand);
        expect(CommandStore.getCommand("feature.modifyChamfer")).toBe(ModifyChamferFeatureCommand);
    });

    test("each starts at the size its own kind starts at", () => {
        expect(new ModifyFilletFeatureCommand().value).toBe(2);
        expect(new ModifyChamferFeatureCommand().value).toBe(1);
    });

    test("the row is the size, measured in length units, with the kind's own label", () => {
        const radius = PropertyUtils.getProperty(new ModifyFilletFeatureCommand(), "value");
        const distance = PropertyUtils.getProperty(new ModifyChamferFeatureCommand(), "value");

        expect(radius?.unit).toEqual({ length: 1, angle: 0 });
        expect(radius?.display).toBe("circle.radius");
        expect(distance?.unit).toEqual({ length: 1, angle: 0 });
        expect(distance?.display).toBe("common.length");
    });
});

describe("ModifyCornerFeatureCommand picking", () => {
    test("picking a round fills the row with the size that feature has", () => {
        const { app, body, select } = scenario([fillet("f1", 5)], ["f1:e9:f"]);

        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));

        expect(cmd.value).toBe(5);
    });

    test("a re-pick of the same feature keeps the size the user just set", () => {
        // Clicking a second round of the same fillet must not undo what was typed: the feature is
        // what is being edited, so the face only names it.
        const { app, body, select } = scenario([fillet("f1", 5)], ["f1:e9:f", "f1:e7:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = 9;

        select([faceData(body, 1)]);
        (cmd as any).onSelectionChanged();

        expect(cmd.value).toBe(9);
    });

    test("picking another feature's face fills the row with that feature's size", () => {
        const { app, body, select } = scenario([fillet("f1", 5), fillet("f2", 3)], ["f1:e9:f", "f2:e7:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = 9;

        select([faceData(body, 1)]);
        (cmd as any).onSelectionChanged();

        expect(cmd.value).toBe(3);
    });

    test("a face the other kind of feature built is refused by name", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const { app, body, select } = scenario([chamfer("c1")], ["c1:e9:f"]);

            const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));

            // The face IS a corner's, just not this command's: naming the kind beats "not a fillet
            // face" when what the user has to do is start the other command.
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "toast.modifyCorner.wrongKind:{0}",
                "command.feature.chamfer",
            );
            expect(cmd.value).toBe(2);
        } finally {
            pub.mockRestore();
        }
    });

    test("only faces whose ids a corner named are admitted to the pick", () => {
        const { app, body, select } = scenario([fillet("f1")], ["f1:e9:f", "sketch:sk1:e1:ent3"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));

        const admitted = (cmd as any).admitDetected([
            faceData(body, 0),
            faceData(body, 1),
            faceData({}, 0),
        ]) as VisualShapeData[];

        expect(admitted.map((x) => x.indexes[0])).toEqual([0]);
    });

    test("once a face has answered, the rest of the pick stays on its body", () => {
        const { app, doc, body, select } = scenario([fillet("f1")], ["f1:e9:f"]);
        const other = new ParametricBodyNode({ document: doc, id: "b2", features: [fillet("f2")] });
        other.hasTrackedIds = () => true;
        other.faceIdAt = () => "f2:e9:f";
        doc.modelManager.addNode(other);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));

        const admitted = (cmd as any).admitDetected([faceData(body), faceData(other)]) as VisualShapeData[];

        expect(admitted.map((x) => x.owner.node)).toEqual([body]);
    });

    test("a chain that will not build draws nothing", () => {
        // The fillet has no input shape to round, so the snapshot fails: no mesh is drawn and
        // nothing is ghosted — a preview that cannot be built is not a preview of anything.
        const { app, body, select } = scenario([fillet("f1", 4)], ["f1:e9:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));

        (cmd as any).showPreview();

        expect(app.activeView!.document.visual.context.displayMesh).not.toHaveBeenCalled();
        expect(app.activeView!.document.visual.highlighter.addState).not.toHaveBeenCalled();
        expect((cmd as any).previewId).toBeUndefined();
    });
});

describe("ModifyCornerFeatureCommand commit", () => {
    test("committing writes the size and leaves the rest of the feature alone", () => {
        const picked = { edgeId: "sketch:sk1:e1.2.3.4:ent1", mid: XYZ.zero } as unknown as EdgeRef;
        const { app, body, select } = scenario([fillet("f1", 2, 3)], ["f1:e9:f"]);
        (body.features[0] as { edges: EdgeRef[] }).edges = [picked];
        const before = body.features[0] as FilletFeatureData;
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = 6;

        (cmd as any).executeMainTask();

        const written = body.features[0] as FilletFeatureData;
        expect(written.radius).toBe(6);
        expect(written.radius2).toBe(before.radius2);
        expect(written.edges).toEqual(before.edges);
    });

    test("a two-distance chamfer keeps its second distance and its mode", () => {
        const { app, body, select } = scenario([chamfer("c1", 1, 4)], ["c1:e9:f"]);
        const cmd = pick(new ModifyChamferFeatureCommand(), app, select, faceData(body));
        cmd.value = 2.5;

        (cmd as any).executeMainTask();

        const written = body.features[0] as ChamferFeatureData;
        expect(written.distance).toBe(2.5);
        expect(written.distance2).toBe(4);
        expect(written.mode).toBe("twoDistance");
    });

    test("the write is one undo step, and the body stays selected", () => {
        const { app, doc, body, select } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = 6;
        const before = doc.history.undoCount();

        (cmd as any).executeMainTask();

        expect(doc.history.undoCount()).toBe(before + 1);
        // The feature panel stays on the row that just changed instead of closing to the document.
        expect((doc.selection.setSelectedNodes as any).mock.calls[0]).toEqual([[body], false]);
    });

    test("a size that will not resolve is refused, and nothing is written", () => {
        const { app, body, select } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = "w * 2";

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).executeMainTask();

            const toast = pub.mock.calls.find((call) => call[0] === "showToast");
            expect(toast?.[1]).toBe("error.default:{0}");
            expect((body.features[0] as FilletFeatureData).radius).toBe(2);
        } finally {
            pub.mockRestore();
        }
    });

    test("the expression the user typed is what the feature keeps", () => {
        // The policy the extrude and fillet commits hold to as well: a feature stores the
        // relation, not the number it happened to evaluate to.
        const { app, doc, body, select } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        doc.variables.setItems([{ id: "v1", name: "w", type: "length", expression: "3" }]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = "w + 1";

        (cmd as any).executeMainTask();

        expect((body.features[0] as FilletFeatureData).radius).toBe("w + 1");
    });

    test("a target deleted from the panel before the confirm is refused", () => {
        // Emptying the list makes the body rebuild from nothing, which only the kernel can do.
        setupShapeFactoryMock({ combine: () => Result.ok(createMockShape()) });
        const { app, body, select } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = 6;
        body.setFeaturesEmitShapeChanged([]);

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).executeMainTask();

            expect(pub).toHaveBeenCalledWith("showToast", "toast.modifyCorner.noTarget");
            expect(body.features).toHaveLength(0);
        } finally {
            pub.mockRestore();
        }
    });

    test("the confirm still writes after the step clears the selection", () => {
        // `MultistepCommand.executeSteps` clears the selection as the pick ends, BEFORE
        // `executeMainTask` runs — the resolved target has to survive that, or every confirm
        // would come back as "nothing picked".
        const { app, doc, body, select } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        cmd.value = 6;

        doc.selection.clearSelection();
        (cmd as any).executeMainTask();

        expect((body.features[0] as FilletFeatureData).radius).toBe(6);
    });

    test("confirming with nothing picked is a toast, not a write", () => {
        const { app, doc } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        const cmd = new ModifyFilletFeatureCommand();
        (cmd as any)._application = app;

        const before = doc.history.undoCount();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).executeMainTask();

            expect(pub).toHaveBeenCalledWith("showToast", "toast.select.noSelected");
            expect(doc.history.undoCount()).toBe(before);
        } finally {
            pub.mockRestore();
        }
    });
});

describe("ModifyCornerFeatureCommand as a whole run", () => {
    test("a face already picked when the command starts is the one being edited", async () => {
        // A face the user pointed at before running the command seeds the gesture instead of
        // answering it — the size is what is being decided — so the pick still opens, and the row
        // opens on that face's own size rather than on the cached default.
        // The arrow's own geometry comes from the kernel, so the test hands the factory one.
        const arrow = () => Result.ok(new MockShape({ shapeType: ShapeTypes.shape }));
        setupShapeFactoryMock({ cylinder: arrow, cone: arrow });
        const { app, doc, body, select } = scenario([fillet("f1", 5)], ["f1:e9:f"]);
        select([faceData(body)]);
        const cmd = new ModifyFilletFeatureCommand();
        (cmd as any)._application = app;
        let onTheRow = 0;
        doc.picker = {
            pickAsync: rs.fn((_handler: unknown, _prompt: unknown, controller: any) => {
                onTheRow = cmd.value as number;
                cmd.value = 6; // what the user drags or types while the pick is open
                controller.success();
                return Promise.resolve();
            }),
        } as any;

        await (cmd as any).executeAsync();

        expect(onTheRow).toBe(5);
        expect((body.features[0] as FilletFeatureData).radius).toBe(6);
    });

    test("a settled hand-off writes the size it was handed, not the feature's own", async () => {
        // What Press Pull hands over: its pick is the answer, and the size it translated the drag
        // into is what gets written — so the step must not ask for the pick again, and putting the
        // feature's own size on the row would silently discard the user's drag.
        const { app, doc, body, select } = scenario([fillet("f1", 3)], ["f1:e9:f"]);
        select([faceData(body)]);
        const cmd = new ModifyFilletFeatureCommand();
        (cmd as any)._application = app;
        cmd.pickSettled = true;
        cmd.value = 7; // the feature's 3 mm radius plus a 4 mm drag
        const pickAsync = rs.fn();
        doc.picker = { pickAsync } as any;

        await (cmd as any).executeAsync();

        expect(pickAsync).not.toHaveBeenCalled();
        expect((body.features[0] as FilletFeatureData).radius).toBe(7);
    });

    test("a pick that is cancelled writes nothing", async () => {
        const { app, doc } = scenario([fillet("f1", 5)], ["f1:e9:f"]);
        const cmd = new ModifyFilletFeatureCommand();
        (cmd as any)._application = app;
        const before = doc.history.undoCount();
        // The picker hands nothing back (Escape, or the pick closed) and never succeeds.
        doc.picker = { pickAsync: rs.fn(() => Promise.resolve()) } as any;

        await (cmd as any).executeAsync();

        expect(doc.history.undoCount()).toBe(before);
    });
});

describe("ModifyCornerFeatureCommand teardown", () => {
    test("the mesh it drew and the ghost it added are both taken back", () => {
        const { app, doc, body, select } = scenario([fillet("f1", 2)], ["f1:e9:f"]);
        const cmd = pick(new ModifyFilletFeatureCommand(), app, select, faceData(body));
        const owner = { node: body } as any;
        (cmd as any).previewId = 7;
        (cmd as any).previewOwner = owner;

        (cmd as any).removePreview();

        expect((doc.visual.context as any).removeMesh).toHaveBeenCalledWith(7);
        expect((doc.visual as any).highlighter.removeState).toHaveBeenCalledWith(
            owner,
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
        expect((cmd as any).previewId).toBeUndefined();
        expect((cmd as any).previewOwner).toBeUndefined();
    });
});
