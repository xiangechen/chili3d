// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    AUTO_TARGETS,
    BoundingBox,
    CommandStore,
    type IShape,
    type IStep,
    Matrix4,
    PropertyUtils,
    Result,
    type ShapeType,
    ShapeTypes,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SELECTED_FACE_STATE } from "../../src/commands/selectedFaceState";
import { SelectThickenFacesStep, ThickenFeatureCommand } from "../../src/commands/thickenCommand";
import type { ThickenFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", { value: methods, writable: true, configurable: true });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

const faceData = (node: unknown, index = 0) =>
    ({
        // Enough of a face for `captureProfileRef`: an empty outer wire is a ref with
        // nothing to fingerprint, which is all these tests need out of it.
        shape: {
            shapeType: ShapeTypes.face,
            isSame: () => false,
            outerWire: () => ({ findSubShapes: () => [] }),
            findSubShapes: () => [],
            boundingBox: () => BoundingBox.zero,
            area: () => 0,
        },
        owner: { node },
        transform: Matrix4.identity(),
        indexes: [index],
        point: new XYZ({ x: 0, y: 0, z: 0 }),
    }) as any;

/** A body whose shape is `shapeType`, with a mesh exposing `faceCount` face ranges. */
function bodyWith(doc: TestDocument, shapeType: ShapeType, faceCount: number): ParametricBodyNode {
    const ranges = Array.from({ length: faceCount }, (_, index) => ({
        start: index,
        count: 1,
        shape: { shapeType: ShapeTypes.face, boundingBox: () => BoundingBox.zero },
    }));
    const shape = {
        shapeType,
        isEqual: () => false,
        dispose: () => {},
        findSubShapes: () => [],
        boundingBox: () => BoundingBox.zero,
        mesh: { faces: { range: ranges, index: new Uint32Array(), position: new Float32Array() } },
    };
    const body = new ParametricBodyNode({ document: doc, features: [] });
    (body as any)._shape = Result.ok(shape);
    doc.modelManager.addNode(body);
    return body;
}

describe("ThickenFeatureCommand registration", () => {
    test("the key the ribbon names resolves to the command", () => {
        // A ribbon item whose key is not registered renders no button at all — silently.
        expect(CommandStore.getCommand("feature.thicken")).toBe(ThickenFeatureCommand);
    });
});

describe("ThickenFeatureCommand face step", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    // Built directly rather than through the command: the command's own callback reaches for
    // `command.application`, which these step-only tests deliberately do not provide.
    const step = (onReady: () => void = rs.fn()): IStep => new SelectThickenFacesStep(onReady);

    const mockSelection = (shapes: any[], nodes: any[]) => {
        doc.selection = {
            getSelectedShapes: () => shapes,
            getSelectedNodes: () => nodes,
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
    };

    test("preselected faces seed the pick instead of committing straight away", async () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const mine = faceData(body);
        mockSelection([mine], []);
        // The user confirms the seeded set unchanged.
        const pickShape = rs.fn((_p: any, _c: any, _o?: any) => Promise.resolve([mine]));
        doc.picker = { pickShape } as any;

        const result = await step().execute(doc, new AsyncController());

        // Seeded, THEN picked: the open pick is what keeps the command (and its live preview)
        // alive long enough to set the thickness.
        // The picked faces read as translucent with their boundary outlined — the state the
        // extrude uses, so a preview drawn over the body stays visible through them.
        expect((doc.selection.setSelectedShapes as any).mock.calls[0]).toEqual([
            [mine],
            SELECTED_FACE_STATE,
            false,
        ]);
        expect(pickShape).toHaveBeenCalledTimes(1);
        expect(result!.nodes).toEqual([body]);
        expect(result!.shapes).toEqual([mine]);
    });

    test("the step reports readiness before the first click, so the preview is up", async () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        mockSelection([faceData(body)], []);
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([])) } as any;
        const onReady = rs.fn();

        await new SelectThickenFacesStep(onReady).execute(doc, new AsyncController());

        expect(onReady).toHaveBeenCalledTimes(1);
    });

    test("a selected surface body seeds its whole face set", async () => {
        const surface = bodyWith(doc, ShapeTypes.shell, 3);
        doc.visual = {
            context: { getVisual: () => ({ node: surface, worldTransform: () => Matrix4.identity() }) },
        } as any;
        mockSelection([], [surface]);
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([])) } as any;
        const controller = new AsyncController();

        await step().execute(doc, controller);

        const seeded = (doc.selection.setSelectedShapes as any).mock.calls[0][0];
        expect(seeded.length).toBe(3);
        expect(seeded.every((x: any) => x.owner.node === surface)).toBe(true);
        expect((doc.selection.setSelectedShapes as any).mock.calls[0][1]).toBe(SELECTED_FACE_STATE);
    });

    test("a selected solid body is not expanded — its faces must be picked one by one", async () => {
        const solid = bodyWith(doc, ShapeTypes.solid, 6);
        const picked = [faceData(solid)];
        mockSelection([], [solid]);
        doc.picker = { pickShape: rs.fn(() => Promise.resolve(picked)) } as any;

        const result = await step().execute(doc, new AsyncController());

        // Nothing seeded: the whole-body selection is not a face set.
        expect((doc.selection.setSelectedShapes as any).mock.calls[0][0]).toEqual([]);
        expect(result!.shapes).toEqual(picked);
    });

    test("picks faces of parametric bodies, several at a time", async () => {
        mockSelection([], []);
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) =>
            Promise.resolve([faceData(body)]),
        );
        doc.picker = { pickShape } as any;

        await step().execute(doc, new AsyncController());

        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.multi).toBe(true);
        expect(options.nodeFilter.allow(body)).toBe(true);
        expect(options.nodeFilter.allow({})).toBe(false);
    });

    test("an empty pick cancels the command", async () => {
        mockSelection([], []);
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([])) } as any;

        expect(await step().execute(doc, new AsyncController())).toBeUndefined();
    });
});

/** A command wired to a mock application and document — enough for its preview to look around. */
function command() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    doc.visual = createMockVisualWithDocument(doc);
    doc.selection = emptySelection();
    const cmd = new ThickenFeatureCommand() as any;
    cmd._application = app;
    return cmd;
}

function emptySelection() {
    return {
        getSelectedShapes: () => [],
        getSelectedNodes: () => [],
        setSelectedShapes: rs.fn(),
        clearSelection: () => {},
    } as any;
}

describe("ThickenFeatureCommand parameters", () => {
    test("the plan follows Onshape's thickness fields", () => {
        const cmd = command();
        cmd.thickness = 6;
        expect(cmd.planOf()).toEqual([6]);

        cmd.thickness2 = 2;
        expect(cmd.planOf()).toEqual([6, -2]);

        cmd.oppositeDirection = true;
        expect(cmd.planOf()).toEqual([-6, 2]);

        // Midplane makes the thickness the TOTAL width, half each way, whatever thickness2 says.
        cmd.midplane = true;
        expect(cmd.planOf()).toEqual([-3, 3]);
    });

    test("the second thickness row hides itself when the midplane is on", () => {
        const cmd = command();
        const declared = PropertyUtils.getProperties(cmd).find((x) => x.name === "thickness2");
        expect(declared?.dependencies).toEqual([{ property: "midplane", value: false }]);

        // The panel re-evaluates a dependent row on a change to the property the dependency
        // NAMES, so that property has to be one that emits one. A derived getter would never,
        // and the row would sit there driving nothing.
        const seen: unknown[] = [];
        cmd.onPropertyChanged((property: string) => seen.push(property));
        cmd.midplane = true;
        expect(seen).toContain("midplane");
    });

    test("every run starts on auto-detection, whatever the last one left behind", () => {
        const cmd = command();
        cmd.targets = { auto: false, ids: ["stale"] };
        const seen: unknown[] = [];
        cmd.onPropertyChanged((property: string) => {
            if (property === "targets") seen.push(cmd.targets);
        });

        cmd.beforeExecute();

        expect(cmd.targets).toEqual(AUTO_TARGETS);
        expect(seen).toEqual([AUTO_TARGETS]);
    });
});

describe("ThickenFeatureCommand commit", () => {
    /** A body whose top face is picked, with a mocked kernel that accepts any thickness. */
    function scenario() {
        const slab = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: () => [],
            boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 2 }),
            mesh: { faces: { range: [] }, edges: { range: [] } },
        };
        const thickenFn = rs.fn((_shape: IShape, _thickness: number) => Result.ok(slab));
        const restoreFactory = mockShapeFactory({
            makeThickSolidBySimple: thickenFn,
            combine: () => Result.ok(slab),
            booleanFuse: () => Result.ok(slab),
            booleanCut: () => Result.ok(slab),
            booleanCommon: () => Result.ok(slab),
        });

        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        // The preview ghosts the source body, displays a mesh and reads the live selection.
        const addState = rs.fn();
        const displayMesh = rs.fn(() => 1);
        doc.visual = createMockVisualWithDocument(doc, {
            highlighter: { addState, removeState: rs.fn() } as any,
            context: { displayMesh } as any,
        });
        doc.selection = emptySelection();
        const body = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(body);
        const picked = faceData(body);

        const cmd = new ThickenFeatureCommand();
        (cmd as any)._application = app;
        cmd.thickness = 5;
        (cmd as any).stepDatas = [{ shapes: [picked], nodes: [body], type: "shape" }];
        return { restoreFactory, doc, body, cmd, thickenFn, slab, addState, displayMesh };
    }

    test("the live selection drives the preview, before the step has recorded anything", () => {
        const { restoreFactory, doc, body, cmd, thickenFn, addState, displayMesh } = scenario();
        try {
            // No step data yet: this is the pick in flight, which is exactly when the preview
            // has to work — the thickness is decided while the faces are still being chosen.
            (cmd as any).stepDatas = [];
            doc.selection = { ...emptySelection(), getSelectedShapes: () => [faceData(body)] } as any;

            (cmd as any).updatePreview();

            expect(thickenFn).toHaveBeenCalledWith(expect.anything(), 5);
            expect(addState).toHaveBeenCalledWith(
                expect.anything(),
                VisualStates.faceTransparent,
                ShapeTypes.shape,
            );
            expect(displayMesh).toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });

    test("a new-body thicken stands the solid up on its own, recording the thickness", () => {
        const { restoreFactory, doc, body, cmd, thickenFn } = scenario();
        try {
            (cmd as any).executeMainTask();

            const created = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode && node !== body,
            ) as ParametricBodyNode;
            expect(created).not.toBeUndefined();
            const feature = created.features[0] as ThickenFeatureData;
            expect(feature.type).toBe("thicken");
            expect(feature.thickness).toBe(5);
            expect(feature.operation).toBeUndefined();
            expect(feature.source.nodeId).toBe(body.id);
            expect(feature.source.profiles.length).toBe(1);
            // The source body is not consumed — only sketches are, and a thicken has none.
            expect(body.visible).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("a midplane cut records both fields and asks the kernel for both halves", () => {
        const { restoreFactory, doc, body, cmd, thickenFn } = scenario();
        try {
            cmd.midplane = true;
            cmd.operation = "option.command.operation.cut";

            (cmd as any).executeMainTask();

            // Every build asks for half the width each way — the preview rebuilds the same
            // pair, so the calls come in pairs rather than once.
            const widths = thickenFn.mock.calls.map((call) => call[1]);
            expect(widths.length).toBeGreaterThanOrEqual(2);
            expect(widths.length % 2).toBe(0);
            for (let i = 0; i < widths.length; i += 2) {
                expect(widths.slice(i, i + 2)).toEqual([2.5, -2.5]);
            }
            expect(body.features.length).toBe(1);
            expect(body.features[0]).toMatchObject({
                type: "thicken",
                midplane: true,
                operation: "cut",
            });
        } finally {
            restoreFactory();
        }
    });

    test("changing a parameter previews the thickened solid with the kernel", () => {
        const { restoreFactory, cmd, thickenFn, slab } = scenario();
        try {
            cmd.thickness = 7;

            // One preview build per settled edit, along the direction the plan names.
            expect(thickenFn).toHaveBeenCalledWith(expect.anything(), 7);
            expect(slab.dispose).toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });

    test("an unresolvable thickness refuses the commit instead of building a zero-width solid", () => {
        const { restoreFactory, doc, body, cmd, thickenFn } = scenario();
        try {
            cmd.thickness = "missingVariable";

            (cmd as any).executeMainTask();

            expect(thickenFn).not.toHaveBeenCalled();
            expect(body.features).toHaveLength(0);
            expect(
                doc.modelManager.findNode((node) => node instanceof ParametricBodyNode && node !== body),
            ).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });
});
