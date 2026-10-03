// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    CommandStore,
    type IFace,
    type INode,
    type IView,
    Matrix4,
    Plane,
    PropertyUtils,
    Ray,
    Result,
    ShapeTypes,
    VisualStates,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { DraftFeatureCommand, SelectNeutralPlaneStep } from "../../src/commands/draftCommand";
import {
    type DraftDragData,
    DraftDragHandler,
    DraftDragStep,
    draftArrowDirection,
    draftLean,
} from "../../src/commands/draftDrag";
import { neutralPlaneInHost } from "../../src/features/draft";
import type { DraftFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { PlanePickHandler } from "../../src/sketch/commands/planePickHandler";

/**
 * A planar face stub centred on `point` with the given outward `normal` — enough of one for
 * `planeOfFace`, `captureFaceRef` and `draftLean` to read it. The bounding box is a ±1 cube about
 * the point, which is what makes the point the face's centre rather than the world origin.
 */
function planarFace(point = XYZ.zero, normal = XYZ.unitZ): IFace {
    const face = {
        shapeType: ShapeTypes.face,
        isSame: () => true,
        normal: () => [point, normal] as [XYZ, XYZ],
        surface: () => ({ isPlanar: () => true }),
        outerWire: () => ({ findSubShapes: () => [] }),
        findSubShapes: () => [],
        boundingBox: () => new BoundingBox(point.sub(new XYZ(1, 1, 1)), point.add(new XYZ(1, 1, 1))),
        area: () => 0,
        transformedMul: () => face,
        dispose: () => {},
    };
    return face as unknown as IFace;
}

/** A picked face owned by `node`, in the node's own frame — what a viewport pick reports. */
const faceData = (node: ParametricBodyNode, index = 0, face: IFace = planarFace()) =>
    ({
        shape: face,
        owner: { node },
        transform: Matrix4.identity(),
        indexes: [index],
        point: XYZ.zero,
    }) as any;

/**
 * A selection with the real toggle semantics of `SelectionManager`: a toggling write removes what
 * is already in, and a non-toggling one replaces the lot. The drag's face picking is built on
 * exactly that contract, so faking it any other way would test nothing.
 */
function mockSelection() {
    let selected: any[] = [];
    return {
        getSelectedShapes: () => selected,
        getSelectedNodes: () => [],
        clearSelection: () => {
            selected = [];
        },
        setSelectedShapes: rs.fn((shapes: any[], _state: unknown, toggle: boolean) => {
            const same = (a: any, b: any) =>
                a.owner === b.owner && a.indexes.join(",") === b.indexes.join(",");
            if (!toggle) {
                selected = [...shapes];
            } else {
                const removed = selected.filter((x) => shapes.some((s) => same(s, x)));
                const added = shapes.filter((s) => !removed.some((x) => same(s, x)));
                selected = [...selected.filter((x) => !removed.includes(x)), ...added];
            }
            return selected.length;
        }),
        setSelectedNodes: rs.fn(),
        getSelectedVisualNodes: () => [],
        getSelectedNodeLength: () => 0,
    } as any;
}

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", { value: methods, writable: true, configurable: true });
    const restore = () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
    pendingRestores.push(restore);
    return restore;
}

/** Mocks installed by a test, restored after it — a leaked kernel stub breaks every later test. */
const pendingRestores: (() => void)[] = [];
afterEach(() => {
    for (const restore of pendingRestores.splice(0)) {
        restore();
    }
});

/**
 * A stub for the arrow's own geometry — the shaft cylinder and the head cone `arrowMeshes`
 * builds. The drag base class scales and moves each mesh into place, so a stub needs a real
 * position buffer rather than a placeholder object.
 */
const stubArrowPart = () =>
    Result.ok({ mesh: { faces: { position: new Float32Array([0, 0, 0]) } }, dispose: rs.fn() });

/** A body whose every face carries a tracked id, so nothing reports a silent identity loss. */
function trackedBody(doc: TestDocument, ids: (string | undefined)[] = ["f0"]): ParametricBodyNode {
    const body = new ParametricBodyNode({ document: doc, features: [] });
    rs.spyOn(body, "faceIdAt").mockImplementation((index: number) => ids[index]);
    rs.spyOn(body, "faceIdIsShared").mockReturnValue(false);
    doc.modelManager.addNode(body);
    return body;
}

const event = (x: number, y: number) =>
    ({
        offsetX: x,
        offsetY: y,
        button: 0,
        buttons: 0,
        isPrimary: true,
        shiftKey: false,
    }) as unknown as PointerEvent;

describe("DraftFeatureCommand registration", () => {
    test("the key the ribbon names resolves to the command", () => {
        // A ribbon item whose key is not registered renders no button at all — silently.
        expect(CommandStore.getCommand("feature.draft")).toBe(DraftFeatureCommand);
    });

    test("every run starts at five degrees with the pull direction unflipped", () => {
        const cmd = new DraftFeatureCommand() as any;

        expect(cmd.angle).toBe(5);
        expect(cmd.reverse).toBe(false);
    });

    test("the angle and reverse rows drive the live handle, so the panel can watch them", () => {
        const cmd = new DraftFeatureCommand() as any;
        const seen: unknown[] = [];
        cmd.onPropertyChanged((property: string) => seen.push(property));
        const setValue = rs.fn();
        const refresh = rs.fn();
        cmd._dragHandler = { setValue, refresh };

        cmd.angle = 12;
        cmd.reverse = true;

        expect(seen).toEqual(["angle", "reverse"]);
        expect(setValue).toHaveBeenCalledWith(12);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("the two rows are the ones the dialog is meant to show", () => {
        const names = PropertyUtils.getProperties(new DraftFeatureCommand()).map((x) => x.name);

        expect(names).toEqual(expect.arrayContaining(["angle", "reverse"]));
    });
});

describe("SelectNeutralPlaneStep", () => {
    function scenario(result: unknown) {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        const view = createHandlerMockView({ document: doc });
        (app as any).activeView = view;
        doc.visual = createMockVisualWithDocument(doc);
        doc.selection = mockSelection();
        const pickAsync = rs.fn(async (handler: unknown, _prompt: unknown, controller: AsyncController) => {
            expect(handler).toBeInstanceOf(PlanePickHandler);
            (handler as PlanePickHandler).result = result as any;
            controller.success();
        });
        doc.picker = { pickAsync } as any;
        const onPicked = rs.fn();
        return { doc, pickAsync, onPicked };
    }

    test("a datum quad picks the datum by name, and nothing is matched geometrically", async () => {
        const { doc, pickAsync, onPicked } = scenario({ kind: "datum", plane: Plane.YZ, name: "YZ" });

        const snapped = await new SelectNeutralPlaneStep(onPicked).execute(doc, new AsyncController());

        expect(pickAsync.mock.calls[0][1]).toBe("prompt.select.plane");
        expect(onPicked).toHaveBeenCalledWith({ ref: { kind: "datum", name: "YZ" }, plane: Plane.YZ });
        expect(snapped!.type).toBe("input");
        expect(snapped!.plane).toBe(Plane.YZ);
    });

    test("a planar face is captured as a world-space ref carrying the owner's tracked id", async () => {
        const { doc, onPicked } = scenario(undefined);
        const body = trackedBody(doc, ["face-7"]);
        const pick = faceData(body, 0, planarFace(new XYZ(0, 0, 30), XYZ.unitZ));
        // The picker hands back the face in the owner's frame; `getNode` maps the visual back to
        // the node the ref has to name.
        doc.visual.context.getNode = () => body as unknown as INode;
        (doc.picker.pickAsync as any).mockImplementation(
            async (handler: unknown, _prompt: unknown, controller: AsyncController) => {
                (handler as PlanePickHandler).result = { kind: "face", data: pick, point: XYZ.zero };
                controller.success();
            },
        );

        await new SelectNeutralPlaneStep(onPicked).execute(doc, new AsyncController());

        const picked = onPicked.mock.calls[0][0];
        expect(picked.ref.kind).toBe("face");
        expect(picked.ref.ref.nodeId).toBe(body.id);
        // The id is what makes the reference survive an upstream rebuild exactly rather than
        // geometrically — and a miss is a silent identity loss, which fails this suite.
        expect(picked.ref.ref.faceId).toBe("face-7");
        // Captured in WORLD coordinates (the plane through z = 30), which is the frame the ref's
        // normal+offset fingerprint is defined in.
        expect(picked.plane.origin.isEqualTo(new XYZ(0, 0, 30))).toBe(true);
    });

    test("a cancelled pick resolves to nothing rather than a half-built plane", async () => {
        const { doc, onPicked } = scenario(undefined);
        doc.picker = {
            pickAsync: rs.fn(async (_handler: unknown, _prompt: unknown, controller: AsyncController) => {
                controller.cancel();
            }),
        } as any;

        const snapped = await new SelectNeutralPlaneStep(onPicked).execute(doc, new AsyncController());

        expect(snapped).toBeUndefined();
        expect(onPicked).not.toHaveBeenCalled();
    });
});

describe("draftLean", () => {
    const worldFace = (point: XYZ, normal: XYZ) => [
        faceData({} as ParametricBodyNode, 0, planarFace(point, normal)),
    ];

    test("anchors on the face centre and leans along the normal's in-plane component", () => {
        // A face standing 10 above XY with an +X normal: it leans along +X, with a 10mm lever.
        const lean = draftLean(worldFace(new XYZ(0, 0, 10), XYZ.unitX), Plane.XY);

        expect(lean).toBeDefined();
        expect(lean!.anchor.isEqualTo(new XYZ(0, 0, 10))).toBe(true);
        expect(lean!.lean.isEqualTo(XYZ.unitX)).toBe(true);
        expect(lean!.height).toBe(10);
    });

    test("a slanted normal contributes only its in-plane part", () => {
        // 45° between the face normal and the plane: the in-plane component is the unit diagonal.
        const lean = draftLean(worldFace(new XYZ(0, 0, 10), new XYZ(1, 0, 1)), Plane.XY);

        expect(lean!.lean.z).toBe(0);
        expect(Math.hypot(lean!.lean.x, lean!.lean.y)).toBeCloseTo(1, 6);
    });

    test("a face lying in the neutral plane has no lever, and no handle", () => {
        // It has no rotation line either, so the kernel would refuse to taper it: no lean is the
        // honest answer rather than a lever of zero that would peg the angle at 90°.
        expect(draftLean(worldFace(XYZ.zero, XYZ.unitX), Plane.XY)).toBeUndefined();
    });

    test("a face parallel to the neutral plane has nothing to lean towards", () => {
        expect(draftLean(worldFace(new XYZ(0, 0, 10), XYZ.unitZ), Plane.XY)).toBeUndefined();
    });

    test("the first face that can carry a handle wins", () => {
        const faces = [...worldFace(XYZ.zero, XYZ.unitX), ...worldFace(new XYZ(0, 0, 10), XYZ.unitY)];

        const lean = draftLean(faces, Plane.XY);

        expect(lean!.anchor.isEqualTo(new XYZ(0, 0, 10))).toBe(true);
        expect(lean!.lean.isEqualTo(XYZ.unitY)).toBe(true);
    });
});

describe("draftArrowDirection", () => {
    test("follows the sign of the angle, like the extrude and offset handles", () => {
        expect(draftArrowDirection(XYZ.unitX, 5).isEqualTo(XYZ.unitX)).toBe(true);
        expect(draftArrowDirection(XYZ.unitX, -5).isEqualTo(new XYZ(-1, 0, 0))).toBe(true);
        // Zero is not negative: the arrow only flips once the angle really is.
        expect(draftArrowDirection(XYZ.unitX, 0).isEqualTo(XYZ.unitX)).toBe(true);
    });
});

describe("DraftDragHandler", () => {
    /** A face standing 10 above XY with an +X normal: a 10mm lever leaning along +X. */
    const leanFace = () => planarFace(new XYZ(0, 0, 10), XYZ.unitX);

    /**
     * A drag session over one body. `hits` is what the viewport reports under the pointer, so a
     * test can decide which face a click lands on.
     */
    function scenario(options: { hits?: unknown[]; ray?: IView["rayAt"]; faces?: unknown[] } = {}) {
        const tool = {
            shapeType: ShapeTypes.solid,
            dispose: rs.fn(),
            transformedMul: () => tool,
            findSubShapes: (type: number) => (type === ShapeTypes.face ? [leanFace()] : []),
            boundingBox: () => BoundingBox.zero,
            mesh: { faces: { range: [] }, edges: { range: [] } },
        };
        const arrowPart = rs.fn(stubArrowPart);
        const draftFn = rs.fn(
            (_shape: unknown, _faces: IFace[], _dir: XYZLike, _angle: number, _plane: Plane) =>
                Result.ok(tool as any),
        );
        mockShapeFactory({
            draft: draftFn,
            combine: () => Result.ok(tool as any),
            cylinder: arrowPart,
            cone: arrowPart,
        });

        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        const view = createHandlerMockView({
            document: doc,
            detectShapes: () => (options.hits ?? []) as any,
            ...(options.ray ? { rayAt: options.ray } : {}),
        });
        (app as any).activeView = view;
        const context = { displayMesh: rs.fn(() => 1), removeMesh: rs.fn(), getVisual: () => ({}) };
        const highlighter = { addState: rs.fn(), removeState: rs.fn() };
        doc.visual = createMockVisualWithDocument(doc, {
            context: context as any,
            highlighter: highlighter as any,
        });
        doc.selection = mockSelection();
        const body = trackedBody(doc, ["f0", "f1"]);
        const onAngle = rs.fn();
        const started = options.faces ?? [faceData(body, 0, leanFace())];
        // Deliberately NOT seeded here: the handler seeds the selection itself, which is what
        // lets the pre-command pick survive (`SelectNeutralPlaneStep` clears it first).

        const drag = new DraftDragHandler(doc, new AsyncController(), {
            neutral: Plane.XY,
            faces: started as any,
            angle: 0,
            buildPreview: () => ({ meshes: [] }),
            onAngle,
        } satisfies DraftDragData);
        return { drag, doc, body, view, onAngle, arrowPart, draftFn, context, highlighter };
    }

    test("a press-and-move drag reads as an ANGLE: travel at the lever becomes atan(travel / height)", () => {
        // The ray meets the lean axis 10mm from the anchor: atan(10 / 10) is exactly 45°.
        const { drag, view } = scenario({
            ray: () => new Ray({ point: new XYZ(10, 5, 10), direction: new XYZ(0, 0, -1) }),
        });

        expect((drag as any).projectValue(view, event(0, 0))).toBeCloseTo(45, 6);
        drag.dispose();
    });

    test("a pointer ray through the anchor reads as zero", () => {
        const { drag, view } = scenario();

        // The default mock ray runs down the anchor's own z line, so no travel has happened.
        expect((drag as any).projectValue(view, event(0, 0))).toBeCloseTo(0, 6);
        drag.dispose();
    });

    test("the arrow points along the lean, and flips once the angle turns negative", () => {
        const { drag, onAngle } = scenario();
        const forward = (drag as any).arrowSegment() as { start: XYZ; end: XYZ };
        expect(forward.end.x - forward.start.x).toBeGreaterThan(0);

        (drag as any).setCurrentValue(-5);

        const flipped = (drag as any).arrowSegment() as { start: XYZ; end: XYZ };
        expect(flipped.end.x - flipped.start.x).toBeLessThan(0);
        expect(onAngle).toHaveBeenCalledWith(-5);
        drag.dispose();
    });

    test("with no face that can carry a lever the arrow is not drawn, and cannot be committed", () => {
        // A face lying IN the neutral plane: no rotation line, so nothing to lean against — this
        // is also the state every draft opens in, before the first face is picked.
        const { drag, view } = scenario({ faces: [] });

        expect((drag as any).arrowSegment()).toEqual({
            start: Plane.XY.origin,
            end: Plane.XY.origin,
        });
        // The base class normalises the direction and drops a degenerate one, so nothing is drawn.
        expect((drag as any).buildArrowMeshes()).toEqual([]);
        expect((drag as any).canConfirm()).toBe(false);
        // And a drag is inert rather than projecting onto an axis that does not exist.
        expect((drag as any).projectValue(view, event(0, 0))).toBe(0);
        drag.dispose();
    });

    test("the faces it opens with are put into the selection, so the first click toggles them", () => {
        // `syncFaces` re-reads the picked set from the selection, so a seed that only lived in
        // the handler's state would be dropped by the very first click.
        const { drag, doc } = scenario();

        expect(doc.selection.getSelectedShapes()).toHaveLength(1);
        expect((drag as any).state.faces).toHaveLength(1);
        drag.dispose();
    });

    test("clicking a face picks it, clicking it again puts it back", () => {
        const { drag, doc, body, view } = scenario({ faces: [] });
        doc.selection.clearSelection();
        // ONE object, as a real viewport reports: the selection identifies a sub-shape by its
        // owner's identity, so a freshly built stand-in would never be recognised as the same one.
        const hit = faceData(body, 0, leanFace());
        (view as any).detectShapes = () => [hit];

        (drag as any).toggleFace(doc.application.activeView, event(0, 0));
        expect(drag.state.faces).toHaveLength(1);

        (drag as any).toggleFace(doc.application.activeView, event(0, 0));
        expect(drag.state.faces).toHaveLength(0);
        drag.dispose();
    });

    test("a click on another body switches the target — one chain per draft", () => {
        const { drag, doc } = scenario({ hits: [] });
        const other = new ParametricBodyNode({ document: doc, features: [] });
        rs.spyOn(other, "faceIdAt").mockReturnValue(undefined);
        doc.modelManager.addNode(other);
        (doc.application.activeView as any).detectShapes = () => [faceData(other, 0, leanFace())];

        (drag as any).toggleFace(doc.application.activeView, event(0, 0));

        expect(drag.state.node).toBe(other);
        expect(drag.state.faces).toHaveLength(1);
        drag.dispose();
    });

    test("the handle moves to another face when the set changes", () => {
        const { drag, doc, body } = scenario({ faces: [] });
        doc.selection.clearSelection();
        const face = (point: XYZ, normal: XYZ) => faceData(body, 0, planarFace(point, normal));

        // Two faces on one body: the first has no lever (it lies in the plane), the second has one.
        doc.selection.setSelectedShapes(
            [face(XYZ.zero, XYZ.unitX), face(new XYZ(0, 0, 6), XYZ.unitY)],
            VisualStates.faceSelected,
            false,
        );
        (drag as any).syncFaces(doc.application.activeView);

        expect((drag as any).axis().origin.isEqualTo(new XYZ(0, 0, 6))).toBe(true);
        drag.dispose();
    });

    test("the body the preview stands in for is ghosted, and put back on dispose", () => {
        const { drag, highlighter } = scenario();

        expect(highlighter.addState).toHaveBeenCalledWith({}, VisualStates.faceTransparent, ShapeTypes.shape);

        drag.dispose();

        expect(highlighter.removeState).toHaveBeenCalledWith(
            {},
            VisualStates.faceTransparent,
            ShapeTypes.shape,
        );
    });

    test("disposing tears the arrow down too", () => {
        const { drag, context } = scenario();

        drag.dispose();

        // The arrow's two meshes (shaft, head) and nothing after them.
        expect((context.removeMesh as any).mock.calls.length).toBe(2);
    });
});

describe("DraftDragStep", () => {
    test("it hands the picked faces and the body to the command, and confirms through the bar", async () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        const view = createHandlerMockView({ document: doc });
        (app as any).activeView = view;
        doc.visual = createMockVisualWithDocument(doc, {
            context: { displayMesh: rs.fn(() => 1), removeMesh: rs.fn(), getVisual: () => ({}) } as any,
        });
        doc.selection = mockSelection();
        const body = trackedBody(doc);
        const face = faceData(body, 0, planarFace(new XYZ(0, 0, 10), XYZ.unitX));
        doc.selection.setSelectedShapes([face], VisualStates.faceSelected, false);
        const arrowPart = rs.fn(stubArrowPart);
        mockShapeFactory({ cylinder: arrowPart, cone: arrowPart });
        doc.picker = {
            pickAsync: rs.fn(async (handler: unknown, _prompt: unknown, controller: AsyncController) => {
                // A drag-release commits: the step has to carry the live state back.
                (handler as DraftDragHandler).commitView = view;
                controller.success();
            }),
        } as any;

        const snapped = await new DraftDragStep("prompt.dragToDraft", () => ({
            neutral: Plane.XY,
            faces: [face],
            angle: 5,
            buildPreview: () => ({ meshes: [] }),
        })).execute(doc, new AsyncController());

        expect(snapped!.shapes).toEqual([face]);
        expect(snapped!.nodes).toEqual([body]);
    });
});

describe("DraftFeatureCommand seed faces", () => {
    /**
     * A command started with one face already selected. The snapshot is taken by `getSteps`,
     * which `MultistepCommand.executeSteps` calls before any step runs — the last moment at
     * which the pre-command selection is still readable.
     */
    function scenario() {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = createHandlerMockView({ document: doc });
        doc.visual = createMockVisualWithDocument(doc);
        doc.selection = mockSelection();
        const body = trackedBody(doc);
        doc.selection.setSelectedShapes([faceData(body, 0)], VisualStates.faceSelected, false);

        const cmd = new DraftFeatureCommand() as any;
        cmd._application = app;
        cmd.neutral = { ref: { kind: "datum", name: "XY" }, plane: Plane.XY };
        return { doc, body, cmd };
    }

    test("the faces picked before the command started are what the drag opens with", () => {
        const { doc, cmd } = scenario();

        cmd.getSteps();
        // What `SelectNeutralPlaneStep` does, on entry and again on exit — the seed has to have
        // been taken before this, or the drag starts with nothing.
        doc.selection.clearSelection();

        expect(cmd.dragData().faces).toHaveLength(1);
    });

    test("the snapshot is not re-taken, so a restart does not come back empty", () => {
        const { doc, cmd } = scenario();

        cmd.getSteps();
        doc.selection.clearSelection();
        // A restart re-enters `getSteps` with the selection already gone; a second snapshot
        // would silently be an empty one.
        cmd.getSteps();

        expect(cmd.dragData().faces).toHaveLength(1);
    });

    test("a command started with nothing selected seeds nothing", () => {
        const { doc, cmd } = scenario();
        doc.selection.clearSelection();

        cmd.getSteps();

        expect(cmd.dragData().faces).toHaveLength(0);
    });
});

describe("DraftFeatureCommand commit", () => {
    /** A command with one picked face and a datum neutral plane, ready to commit. */
    function scenario() {
        // The picked face IS the body's only face, which is what lets the preview's re-match —
        // tracked id first — find it again on the shape it holds. It stands 10 above the XY plane
        // with an +X normal, so it has a lever and a lean for the angle handle.
        const face = planarFace(new XYZ(0, 0, 10), XYZ.unitX);
        const tool = {
            shapeType: ShapeTypes.solid,
            dispose: rs.fn(),
            transformedMul: () => tool,
            findSubShapes: (type: number) => (type === ShapeTypes.face ? [face] : []),
            boundingBox: () => BoundingBox.zero,
            mesh: { faces: { range: [] }, edges: { range: [] } },
        };
        // Typed with the factory's own signature so `mock.calls` reads back the real arguments.
        const draftFn = rs.fn(
            (_shape: unknown, _faces: IFace[], _dir: XYZLike, _angle: number, _plane: Plane) =>
                Result.ok(tool as any),
        );
        // The body wraps the chain's output in a compound, so `combine` is on the preview's path.
        const restoreFactory = mockShapeFactory({ draft: draftFn, combine: () => Result.ok(tool as any) });

        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = createHandlerMockView({ document: doc });
        doc.visual = createMockVisualWithDocument(doc);
        doc.selection = mockSelection();
        const body = trackedBody(doc);
        // Seed the shape the body already holds rather than replaying a chain: what the preview
        // reads is the CURRENT shape, and a replay has no kernel behind it here.
        Object.defineProperty(body, "_shape", { value: Result.ok(tool as any), writable: true });
        Object.defineProperty(body, "_evaluated", { value: true, writable: true });
        Object.defineProperty(body, "mesh", { value: { faces: { range: [] }, edges: { range: [] } } });

        const cmd = new DraftFeatureCommand() as any;
        cmd._application = app;
        // The step order the command itself uses: the neutral plane, then the pick-and-drag step.
        cmd.stepDatas = [
            { shapes: [], type: "input", plane: Plane.XY },
            { shapes: [faceData(body, 0, face)], nodes: [body], type: "shape" },
        ];
        cmd.neutral = { ref: { kind: "datum", name: "XY" }, plane: Plane.XY };
        return { restoreFactory, doc, body, cmd, draftFn, tool, face };
    }

    test("committing appends the feature with the picked faces, the plane and the angle", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.angle = 7;

            cmd.executeMainTask();

            expect(body.features).toHaveLength(1);
            const feature = body.features[0] as DraftFeatureData;
            expect(feature.type).toBe("draft");
            expect(feature.angle).toBe(7);
            expect(feature.faces).toHaveLength(1);
            expect(feature.neutralPlane).toEqual({ kind: "datum", name: "XY" });
            // The defaults stay off the payload: an absent flag is the default, and recording them
            // would freeze today's default into every document saved with it.
            expect(feature.reverse).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("the opposite-direction choice is recorded on the feature", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.reverse = true;

            cmd.executeMainTask();

            expect(body.features[0]).toMatchObject({ type: "draft", reverse: true });
        } finally {
            restoreFactory();
        }
    });

    test("an angle that does not resolve refuses the commit instead of tapering by nothing", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.angle = "missingVariable";

            cmd.executeMainTask();

            expect(body.features).toHaveLength(0);
        } finally {
            restoreFactory();
        }
    });

    test("a zero angle is refused too — it would be a feature that quietly does nothing", () => {
        // Measured: the kernel does not fail at zero, it hands the input straight back.
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.angle = 0;

            cmd.executeMainTask();

            expect(body.features).toHaveLength(0);
        } finally {
            restoreFactory();
        }
    });

    test("committing with no face picked is refused — there is nothing to taper", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.stepDatas[1] = { shapes: [], nodes: [body], type: "shape" };

            cmd.executeMainTask();

            expect(body.features).toHaveLength(0);
        } finally {
            restoreFactory();
        }
    });

    test("committing with no neutral plane is refused — the taper has nothing to measure from", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.neutral = undefined;

            cmd.executeMainTask();

            expect(body.features).toHaveLength(0);
        } finally {
            restoreFactory();
        }
    });

    test("the neutral plane is picked first, then one step does the faces and the angle", () => {
        // The plane decides whether a face can be tapered at all, and it is what the handle is
        // measured against — so it has to come first for the handle to be up while picking.
        // Built through the shared scenario because `getSteps` snapshots the selection, which
        // needs a document.
        const { restoreFactory, cmd } = scenario();
        try {
            const steps = cmd.getSteps() as unknown[];

            expect(steps).toHaveLength(2);
            expect(steps[0]).toBeInstanceOf(SelectNeutralPlaneStep);
            expect(steps[1]).toBeInstanceOf(DraftDragStep);
        } finally {
            restoreFactory();
        }
    });

    test("the preview is the same kernel call the feature will make", () => {
        const { restoreFactory, cmd, draftFn, tool } = scenario();
        try {
            cmd.angle = 4;

            const state = { node: cmd.stepDatas[1].nodes[0], faces: cmd.stepDatas[1].shapes, angle: 4 };
            const preview = (cmd as any).buildPreview(state);

            expect(draftFn).toHaveBeenCalledTimes(1);
            const [shape, faces, direction, angle] = draftFn.mock.calls[0];
            expect(shape).toBe(tool);
            expect(faces).toHaveLength(1);
            expect(angle).toBe(4);
            // XY's normal is +Z; a positive angle takes material off the side it points to.
            expect((direction as XYZ).isEqualTo(XYZ.unitZ)).toBe(true);
            expect(preview.meshes.length).toBeGreaterThan(0);
        } finally {
            restoreFactory();
        }
    });

    test("the reverse row flips the pull direction the preview is built with", () => {
        const { restoreFactory, cmd, draftFn } = scenario();
        try {
            cmd.angle = 4;
            cmd.reverse = true;

            (cmd as any).buildPreview({
                node: cmd.stepDatas[1].nodes[0],
                faces: cmd.stepDatas[1].shapes,
                angle: 4,
            });

            const direction = draftFn.mock.calls[0][2] as XYZ;
            expect(direction.isEqualTo(new XYZ(0, 0, -1))).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("nothing is previewed before a body is picked, or at a zero angle", () => {
        const { restoreFactory, cmd, draftFn } = scenario();
        try {
            expect((cmd as any).buildPreview({ faces: [], angle: 5 }).meshes).toEqual([]);

            cmd.angle = 0;
            expect(
                (cmd as any).buildPreview({
                    node: cmd.stepDatas[1].nodes[0],
                    faces: cmd.stepDatas[1].shapes,
                    angle: 0,
                }).meshes,
            ).toEqual([]);
            expect(draftFn).not.toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });

    test("a body whose transform cannot be inverted is refused rather than thrown", () => {
        const { restoreFactory, cmd } = scenario();
        try {
            expect(
                neutralPlaneInHost(Plane.XY, {
                    id: "b1",
                    worldTransform: () => Matrix4.fromScale(0, 1, 1),
                }).isOk,
            ).toBe(false);
        } finally {
            restoreFactory();
        }
    });
});

describe("neutralPlaneInHost", () => {
    test("maps a world plane into the body's own frame", () => {
        // The kernel runs in the body's frame while the neutral plane is captured in world
        // coordinates, so a moved body is where a missing mapping would show up as a taper about
        // the wrong plane.
        const host = { id: "b1", worldTransform: () => Matrix4.fromTranslation(0, 0, 100) };
        const world = new Plane({ origin: new XYZ(0, 0, 120), normal: XYZ.unitZ, xvec: XYZ.unitX });

        const local = neutralPlaneInHost(world, host);

        expect(local.isOk).toBe(true);
        expect(local.unchecked()!.origin.isEqualTo(new XYZ(0, 0, 20))).toBe(true);
        expect(local.unchecked()!.normal.isEqualTo(XYZ.unitZ)).toBe(true);
    });
});
