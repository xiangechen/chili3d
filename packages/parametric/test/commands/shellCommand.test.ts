// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    CommandStore,
    type IShape,
    Matrix4,
    PropertyUtils,
    Result,
    ShapeTypes,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SELECTED_FACE_STATE } from "../../src/commands/selectedFaceState";
import { SelectShellFacesStep, ShellFeatureCommand } from "../../src/commands/shellCommand";
import type { ShellFeatureData } from "../../src/features/feature";
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
        // Enough of a face for `captureProfileRef`: an empty outer wire is a ref with nothing to
        // fingerprint, which is all these tests need out of it.
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
        point: XYZ.zero,
    }) as any;

const emptySelection = () =>
    ({
        getSelectedShapes: () => [],
        getSelectedNodes: () => [],
        setSelectedShapes: rs.fn(),
        clearSelection: () => {},
    }) as any;

/** A command wired to a mock application and document — enough for its preview to look around. */
function command() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    doc.visual = createMockVisualWithDocument(doc);
    doc.selection = emptySelection();
    const cmd = new ShellFeatureCommand() as any;
    cmd._application = app;
    return cmd;
}

describe("ShellFeatureCommand registration", () => {
    test("the key the ribbon names resolves to the command", () => {
        // A ribbon item whose key is not registered renders no button at all — silently.
        expect(CommandStore.getCommand("feature.shell")).toBe(ShellFeatureCommand);
    });

    test("every run starts with the wall inside and a rounded join", () => {
        const cmd = command();

        expect(cmd.outward).toBe(false);
        expect(cmd.joinType).toBe("option.command.joinType.arc");
    });

    test("the outward and join-type rows drive a preview, so the panel can watch them", () => {
        const cmd = command();
        const seen: unknown[] = [];
        cmd.onPropertyChanged((property: string) => seen.push(property));

        cmd.outward = true;
        cmd.joinType = "option.command.joinType.intersection";

        expect(seen).toEqual(["outward", "joinType"]);
    });

    test("the three rows are the ones the dialog is meant to show", () => {
        const names = PropertyUtils.getProperties(new ShellFeatureCommand()).map((x) => x.name);

        expect(names).toEqual(expect.arrayContaining(["thickness", "outward", "joinType"]));
    });
});

describe("SelectShellFacesStep", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    const mockSelection = (shapes: any[], nodes: any[]) => {
        doc.selection = {
            getSelectedShapes: () => shapes,
            getSelectedNodes: () => nodes,
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
    };

    test("asks for the faces to open, several at a time", async () => {
        mockSelection([], []);
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) =>
            Promise.resolve([faceData(body)]),
        );
        doc.picker = { pickShape } as any;

        await new SelectShellFacesStep().execute(doc, new AsyncController());

        expect(pickShape.mock.calls[0][0]).toBe("prompt.select.openFaces");
        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.multi).toBe(true);
        expect(options.nodeFilter.allow(body)).toBe(true);
        expect(options.nodeFilter.allow({})).toBe(false);
    });

    test("preselected faces seed the pick, which stays open for the thickness", async () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const mine = faceData(body);
        mockSelection([mine], []);
        const pickShape = rs.fn(() => Promise.resolve([mine]));
        doc.picker = { pickShape } as any;
        const onReady = rs.fn();

        const result = await new SelectShellFacesStep(onReady).execute(doc, new AsyncController());

        expect((doc.selection.setSelectedShapes as any).mock.calls[0]).toEqual([
            [mine],
            SELECTED_FACE_STATE,
            false,
        ]);
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(result!.nodes).toEqual([body]);
    });

    test("a selected solid body is NOT expanded to all its faces", async () => {
        // Opening nothing would leave the body solid, and opening everything is a different
        // feature than the user asked for — the faces are picked one by one.
        const body = new ParametricBodyNode({ document: doc, features: [] });
        mockSelection([], [body]);
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([faceData(body)])) } as any;

        await new SelectShellFacesStep().execute(doc, new AsyncController());

        expect((doc.selection.setSelectedShapes as any).mock.calls[0][0]).toEqual([]);
    });
});

describe("ShellFeatureCommand commit", () => {
    /** A body whose top face is picked, with a mocked kernel that accepts any wall. */
    function scenario() {
        const tool = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            transformedMul: () => tool,
            findSubShapes: () => [],
            boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
            mesh: { faces: { range: [] }, edges: { range: [] } },
        };
        const shellFn = rs.fn((_shape: IShape, _faces: IShape[], _t: number, _j: string) => Result.ok(tool));
        const restoreFactory = mockShapeFactory({
            makeThickSolidByJoin: shellFn,
            combine: () => Result.ok(tool),
        });

        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.visual = createMockVisualWithDocument(doc, {
            highlighter: { addState: rs.fn(), removeState: rs.fn() } as any,
            context: { displayMesh: rs.fn(() => 1) } as any,
        });
        doc.selection = emptySelection();
        const body = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(body);

        const cmd = new ShellFeatureCommand();
        (cmd as any)._application = app;
        (cmd as any).stepDatas = [{ shapes: [faceData(body)], nodes: [body], type: "shape" }];
        return { restoreFactory, doc, body, cmd, shellFn, tool };
    }

    test("committing appends the feature with the picked faces and the thickness", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.thickness = 3;

            (cmd as any).executeMainTask();

            expect(body.features).toHaveLength(1);
            const feature = body.features[0] as ShellFeatureData;
            expect(feature.type).toBe("shell");
            expect(feature.thickness).toBe(3);
            expect(feature.faces).toHaveLength(1);
            // The defaults stay off the payload: an absent flag is the default, and recording
            // them would freeze today's default into every document saved with it.
            expect(feature.outward).toBeUndefined();
            expect(feature.joinType).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("the outward and join-type choices are recorded on the feature", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.outward = true;
            cmd.joinType = "option.command.joinType.intersection";
            cmd.thickness = 3;

            (cmd as any).executeMainTask();

            expect(body.features[0]).toMatchObject({
                type: "shell",
                outward: true,
                joinType: "intersection",
            });
        } finally {
            restoreFactory();
        }
    });

    test("outward asks the kernel for the positive side and the default for the negative one", () => {
        const { restoreFactory, cmd } = scenario();
        try {
            cmd.thickness = 4;
            // Negative carves the wall out of the input, positive adds it outside (the kernel's
            // own sign convention) — so `outward` flips the sign and never the magnitude.
            expect((cmd as any).signedThickness).toBe(-4);

            cmd.outward = true;
            expect((cmd as any).signedThickness).toBe(4);
        } finally {
            restoreFactory();
        }
    });

    test("an unresolvable thickness refuses the commit instead of hollowing by zero", () => {
        const { restoreFactory, doc, body, cmd, shellFn } = scenario();
        try {
            shellFn.mockClear();
            cmd.thickness = "missingVariable";

            (cmd as any).executeMainTask();

            expect(body.features).toHaveLength(0);
            void doc;
        } finally {
            restoreFactory();
        }
    });

    test("committing with nothing open is refused — that is not a shell", () => {
        const { restoreFactory, body, cmd, shellFn } = scenario();
        try {
            shellFn.mockClear();
            (cmd as any).stepDatas = [{ shapes: [], nodes: [body], type: "shape" }];

            (cmd as any).executeMainTask();

            // The kernel answers an empty closing set with the shrunken solid, not a hollow body.
            expect(body.features).toHaveLength(0);
        } finally {
            restoreFactory();
        }
    });
});
