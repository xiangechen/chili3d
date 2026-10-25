// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    CommandStore,
    type IShape,
    Matrix4,
    PropertyUtils,
    PubSub,
    Result,
    SELECTED_FACE_STATE,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { OffsetFaceFeatureCommand, SelectOffsetFacesStep } from "../../src/commands/offsetFaceCommand";
import type { OffsetFaceFeatureData } from "../../src/features/feature";
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
        onShapeChanged: { sub: rs.fn(), remove: rs.fn() },
    }) as any;

describe("OffsetFaceFeatureCommand registration", () => {
    test("the key the ribbon names resolves to the command", () => {
        // A ribbon item whose key is not registered renders no button at all — silently.
        expect(CommandStore.getCommand("feature.offsetFace")).toBe(OffsetFaceFeatureCommand);
    });

    test("every run starts with a 2 mm move", () => {
        expect(new OffsetFaceFeatureCommand().distance).toBe(2);
    });

    test("the distance row drives a preview, so the panel can watch it", () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.visual = createMockVisualWithDocument(doc);
        doc.selection = emptySelection();
        const cmd = new OffsetFaceFeatureCommand() as any;
        cmd._application = app;
        const seen: unknown[] = [];
        cmd.onPropertyChanged((property: string) => seen.push(property));

        cmd.distance = 7;

        expect(seen).toEqual(["distance"]);
    });

    test("the rows are the distance and the keep-rounds switch", () => {
        const names = PropertyUtils.getProperties(new OffsetFaceFeatureCommand()).map((x) => x.name);

        expect(names).toEqual(expect.arrayContaining(["distance", "keepRounds"]));
    });

    test("a new offset keeps the rounds' radius unless the switch is turned off", () => {
        expect(new OffsetFaceFeatureCommand().keepRounds).toBe(true);
    });
});

describe("SelectOffsetFacesStep", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    test("asks for the faces to move, several at a time, on parametric bodies", async () => {
        doc.selection = emptySelection();
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) =>
            Promise.resolve([faceData(body)]),
        );
        doc.picker = { pickShape } as any;

        await new SelectOffsetFacesStep().execute(doc, new AsyncController());

        expect(pickShape.mock.calls[0][0]).toBe("prompt.select.faces");
        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.multi).toBe(true);
        expect(options.nodeFilter.allow(body)).toBe(true);
        expect(options.nodeFilter.allow({})).toBe(false);
    });

    test("preselected faces seed the pick, which stays open for the distance", async () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const mine = faceData(body);
        doc.selection = {
            getSelectedShapes: () => [mine],
            getSelectedNodes: () => [body],
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([mine])) } as any;
        const onReady = rs.fn();

        const result = await new SelectOffsetFacesStep(onReady).execute(doc, new AsyncController());

        expect((doc.selection.setSelectedShapes as any).mock.calls[0]).toEqual([
            [mine],
            SELECTED_FACE_STATE,
            false,
        ]);
        expect(onReady).toHaveBeenCalledTimes(1);
        expect(result!.nodes).toEqual([body]);
    });
});

describe("SelectOffsetFacesStep with a settled pick", () => {
    const doc = new TestDocument({ application: createMockApplication() });

    test("takes the selection as the answer instead of asking for the same click twice", async () => {
        // Press Pull picks the face AND confirms it; this command's own confirm would be a second
        // click on the same thing, so its step reads the selection and finishes.
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const mine = faceData(body);
        doc.selection = {
            getSelectedShapes: () => [mine],
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
        const pickShape = rs.fn(() => Promise.resolve([mine]));
        doc.picker = { pickShape } as any;
        const controller = new AsyncController();

        const result = await new SelectOffsetFacesStep(() => {}, true).execute(doc, controller);

        expect(pickShape).not.toHaveBeenCalled();
        expect(controller.result?.status).toBe("success");
        expect(result!.shapes).toEqual([mine]);
        expect(result!.nodes).toEqual([body]);
    });

    test("unsettled, it seeds the pick and waits as it always did", async () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const mine = faceData(body);
        doc.selection = {
            getSelectedShapes: () => [mine],
            setSelectedShapes: rs.fn(),
            clearSelection: () => {},
        } as any;
        const pickShape = rs.fn((_p: any, _c: any, _o?: any) => Promise.resolve([mine]));
        doc.picker = { pickShape } as any;

        await new SelectOffsetFacesStep(() => {}, false).execute(doc, new AsyncController());

        expect(pickShape).toHaveBeenCalledTimes(1);
    });
});

describe("OffsetFaceFeatureCommand commit", () => {
    /** A body whose top face is picked, with a mocked kernel that accepts any move. */
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
        const offsetFn = rs.fn((_shape: IShape, _faces: IShape[], _d: number) =>
            Result.ok({ shape: tool, faceAncestors: [], edgeAncestors: [] }),
        );
        const restoreFactory = mockShapeFactory({
            offsetFacesTracked: offsetFn,
            combine: () => Result.ok(tool),
        });

        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.visual = createMockVisualWithDocument(doc, {
            highlighter: { addState: rs.fn(), removeState: rs.fn() } as any,
            context: { displayMesh: rs.fn(() => 1), removeMesh: rs.fn() } as any,
        });
        doc.selection = emptySelection();
        const body = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(body);

        const cmd = new OffsetFaceFeatureCommand();
        (cmd as any)._application = app;
        (cmd as any).stepDatas = [{ shapes: [faceData(body)], nodes: [body], type: "shape" }];
        return { restoreFactory, doc, body, cmd, offsetFn, tool };
    }

    test("committing appends the feature with the picked faces and the distance", () => {
        const { restoreFactory, body, cmd } = scenario();
        try {
            cmd.distance = -3;

            (cmd as any).executeMainTask();

            expect(body.features).toHaveLength(1);
            const feature = body.features[0] as OffsetFaceFeatureData;
            expect(feature.type).toBe("offsetFace");
            expect(feature.distance).toBe(-3);
            expect(feature.faces).toHaveLength(1);
        } finally {
            restoreFactory();
        }
    });

    test("a distance of 0 is a toast and no feature", () => {
        const { restoreFactory, body, cmd } = scenario();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            cmd.distance = 0;

            (cmd as any).executeMainTask();

            expect(body.features).toHaveLength(0);
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Enter a distance other than 0",
            );
        } finally {
            pub.mockRestore();
            restoreFactory();
        }
    });

    test("committing with no face picked is a toast and no feature", () => {
        const { restoreFactory, body, cmd } = scenario();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).stepDatas = [{ shapes: [], nodes: [body], type: "shape" }];

            (cmd as any).executeMainTask();

            expect(body.features).toHaveLength(0);
            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Select at least one face to move",
            );
        } finally {
            pub.mockRestore();
            restoreFactory();
        }
    });

    test("a preview on a body whose chain did not build draws nothing", () => {
        const { restoreFactory, cmd, offsetFn } = scenario();
        try {
            cmd.distance = 4;

            (cmd as any).updatePreview();

            expect(offsetFn).not.toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });
});
