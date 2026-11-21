// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    BoundingBox,
    CancelableCommand,
    type IFace,
    type INodeVisual,
    type IPicker,
    type ISelection,
    type IShape,
    Matrix4,
    Plane,
    PubSub,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SplitFeatureCommand, SplitPreviewHandler } from "../../src/commands/splitCommand";
import type { SplitFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { PlanePickHandler } from "../../src/sketch/commands/planePickHandler";

const KEEP_BOTH = "option.command.keepSide.both";
const KEEP_POSITIVE = "option.command.keepSide.positive";
const KEEP_NEGATIVE = "option.command.keepSide.negative";

function mockShape(minZ: number, maxZ: number): IShape {
    const shape = {
        boundingBox: () => new BoundingBox(new XYZ(-10, -10, minZ), new XYZ(10, 10, maxZ)),
        mesh: {
            faces: { position: new Float32Array([0, 0, 0]) },
            edges: { position: new Float32Array([0, 0, 0]) },
        },
        transformedMul: () => shape,
        dispose: rs.fn(),
    };
    return shape as unknown as IShape;
}

function planarFace(): IFace {
    const face = {
        shapeType: ShapeTypes.face,
        isSame: () => true,
        normal: () => [XYZ.zero, XYZ.unitZ] as [XYZ, XYZ],
        surface: () => ({ isPlanar: () => true }),
        outerWire: () => ({ findSubShapes: () => [] }),
        findSubShapes: () => [],
        boundingBox: () => new BoundingBox(new XYZ(-10, -10, 0), new XYZ(10, 10, 0)),
        area: () => 400,
        transformedMul: () => face,
        dispose: () => {},
    };
    return face as unknown as IFace;
}

function curvedFace(): IFace {
    const face = planarFace();
    face.surface = () => ({ isPlanar: () => false }) as unknown as ReturnType<IFace["surface"]>;
    return face;
}

interface ScenarioOptions {
    readonly datum?: boolean;
    readonly positiveOnly?: boolean;
    readonly centerOnly?: boolean;
}

function scenario(face: IFace = planarFace(), options: ScenarioOptions = {}) {
    CancelableCommand.seedOptions("feature.split", { keepSide: KEEP_BOTH });
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    const view = createHandlerMockView({ document: doc });
    Object.defineProperty(app, "activeView", { value: view, writable: true });

    const negative = mockShape(-10, 0);
    const positive = mockShape(0, 10);
    const split = mockShape(-10, 10);
    const center = mockShape(0, 0);
    const pieces = options.centerOnly ? [center] : options.positiveOnly ? [positive] : [negative, positive];
    const directSubShapes = rs.fn(() => pieces);
    split.directSubShapes = directSubShapes;
    const input = mockShape(-10, 10);
    input.split = rs.fn(() => split);

    const body = new ParametricBodyNode({ document: doc, features: [] });
    Object.defineProperty(body, "shape", { value: Result.ok(input) });
    rs.spyOn(body, "faceIdAt").mockReturnValue("face-0");
    const setFeatures = rs.spyOn(body, "setFeaturesEmitShapeChanged").mockImplementation(() => {});
    doc.modelManager.addNode(body);

    let meshId = 0;
    const displayMesh = rs.fn(() => ++meshId);
    const removeMesh = rs.fn();
    const setVisible = rs.fn();
    doc.visual = createMockVisualWithDocument(doc, {
        context: {
            displayMesh,
            removeMesh,
            setVisible,
            getNode: () => body,
        },
    });
    doc.selection = {
        getSelectedNodes: () => [body],
        getSelectedShapes: () => [],
        clearSelection: rs.fn(),
        setSelectedShapes: rs.fn(),
        setSelectedNodes: rs.fn(),
    } as unknown as ISelection;

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    const rect = rs.fn(() => Result.ok({ dispose: rs.fn() }));
    Object.defineProperty(globalThis, "shapeFactory", {
        value: { rect },
        writable: true,
        configurable: true,
    });

    let previewHandler: SplitPreviewHandler | undefined;
    let openPreview = () => {};
    const previewOpened = new Promise<void>((resolve) => {
        openPreview = resolve;
    });
    const pickAsync = rs.fn(
        async (
            handler: PlanePickHandler | SplitPreviewHandler,
            _prompt: string,
            controller: AsyncController,
        ) => {
            if (handler instanceof PlanePickHandler) {
                handler.result = options.datum
                    ? { kind: "datum", plane: Plane.ZX, name: "ZX", point: XYZ.zero }
                    : {
                          kind: "face",
                          data: {
                              shape: face,
                              owner: { node: body } as unknown as INodeVisual,
                              transform: Matrix4.identity(),
                              indexes: [0],
                              point: XYZ.zero,
                          },
                          point: XYZ.zero,
                      };
                controller.success();
                return;
            }
            previewHandler = handler;
            openPreview();
            await new Promise<void>((resolve) => {
                controller.onCompleted(() => resolve());
                controller.onCancelled(() => resolve());
                controller.onFailed(() => resolve());
            });
        },
    );
    doc.picker = { pickAsync } as unknown as IPicker;

    const command = new SplitFeatureCommand();
    const executing = command.execute(app);
    const restore = () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            Reflect.deleteProperty(globalThis, "shapeFactory");
        }
    };
    return {
        command,
        doc,
        view,
        body,
        executing,
        previewOpened,
        getPreview: () => previewHandler,
        setFeatures,
        directSubShapes,
        displayMesh,
        removeMesh,
        setVisible,
        restore,
    };
}

function key(key: string): KeyboardEvent {
    return {
        key,
        preventDefault: rs.fn(),
        stopImmediatePropagation: rs.fn(),
    } as unknown as KeyboardEvent;
}

describe("SplitFeatureCommand preview", () => {
    test("a solid face opens a preview and only confirmation commits the selected side", async () => {
        const s = scenario();
        try {
            await s.previewOpened;
            const preview = s.getPreview();
            expect(preview).toBeInstanceOf(SplitPreviewHandler);
            if (preview === undefined) throw new Error("Preview did not open");
            expect(s.setFeatures).not.toHaveBeenCalled();
            expect(s.setVisible).toHaveBeenCalledWith(s.body, false);

            const displayed = s.displayMesh.mock.calls.length;
            expect(s.directSubShapes).not.toHaveBeenCalled();
            s.command.keepSide = KEEP_NEGATIVE;
            expect(s.directSubShapes).toHaveBeenCalled();
            expect(s.displayMesh.mock.calls.length).toBeGreaterThan(displayed);
            expect(s.setFeatures).not.toHaveBeenCalled();

            preview.keyDown(s.view, key("Enter"));
            await s.executing;

            expect(s.setFeatures).toHaveBeenCalledTimes(1);
            const feature = s.setFeatures.mock.calls[0][0][0] as SplitFeatureData;
            expect(feature.type).toBe("split");
            expect(feature.keepSide).toBe("negative");
            expect(feature.tool.kind).toBe("face");
            expect(s.removeMesh).toHaveBeenCalled();
        } finally {
            s.restore();
        }
    });

    test("a curved solid face previews and commits as a surface tool", async () => {
        const s = scenario(curvedFace());
        try {
            await s.previewOpened;
            const preview = s.getPreview();
            expect(preview).toBeInstanceOf(SplitPreviewHandler);
            if (preview === undefined) throw new Error("Preview did not open");
            expect(s.setFeatures).not.toHaveBeenCalled();

            preview.keyDown(s.view, key("Enter"));
            await s.executing;

            const feature = s.setFeatures.mock.calls[0][0][0] as SplitFeatureData;
            expect(feature.tool.kind).toBe("surface");
            if (feature.tool.kind !== "surface") throw new Error("Expected a surface tool");
            expect(feature.tool.profiles).toHaveLength(1);
            expect(feature.keepSide).toBeUndefined();
        } finally {
            s.restore();
        }
    });

    test("a datum plane previews and commits through the same confirmation path", async () => {
        const s = scenario(planarFace(), { datum: true });
        try {
            await s.previewOpened;
            const preview = s.getPreview();
            expect(preview).toBeInstanceOf(SplitPreviewHandler);
            if (preview === undefined) throw new Error("Preview did not open");
            expect(s.displayMesh).toHaveBeenCalled();
            expect(s.setFeatures).not.toHaveBeenCalled();

            preview.keyDown(s.view, key("Enter"));
            await s.executing;

            const feature = s.setFeatures.mock.calls[0][0][0] as SplitFeatureData;
            expect(feature.tool).toEqual({ kind: "datum", name: "ZX" });
        } finally {
            s.restore();
        }
    });

    test("a failed preview reports its error once and cannot commit", async () => {
        const s = scenario(planarFace(), { positiveOnly: true });
        const pub = rs.spyOn(PubSub.default, "pub");
        try {
            await s.previewOpened;
            const preview = s.getPreview();
            expect(preview).toBeInstanceOf(SplitPreviewHandler);
            if (preview === undefined) throw new Error("Preview did not open");

            s.command.keepSide = KEEP_NEGATIVE;
            preview.refresh();
            const errors = pub.mock.calls.filter((call) => call[0] === "showToast");
            expect(errors).toHaveLength(1);
            expect(errors[0]).toEqual([
                "showToast",
                "error.default:{0}",
                "Split: nothing remains on the kept side — the tool misses the input",
            ]);

            preview.keyDown(s.view, key("Enter"));
            expect(s.setFeatures).not.toHaveBeenCalled();
            s.command.keepSide = KEEP_BOTH;
            preview.keyDown(s.view, key("Enter"));
            await s.executing;
            expect(s.setFeatures).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            s.restore();
        }
    });

    test("changing the kept side reports a repeated error again without toast spam", async () => {
        const s = scenario(planarFace(), { centerOnly: true });
        const pub = rs.spyOn(PubSub.default, "pub");
        const errorCalls = () => pub.mock.calls.filter((call) => call[0] === "showToast");
        try {
            await s.previewOpened;
            const preview = s.getPreview();
            expect(preview).toBeInstanceOf(SplitPreviewHandler);
            if (preview === undefined) throw new Error("Preview did not open");

            s.command.keepSide = KEEP_POSITIVE;
            preview.refresh();
            expect(errorCalls()).toHaveLength(1);
            s.command.keepSide = KEEP_NEGATIVE;
            preview.refresh();
            expect(errorCalls()).toHaveLength(2);
            expect(errorCalls()[0][2]).toBe(errorCalls()[1][2]);

            s.command.keepSide = KEEP_BOTH;
            preview.keyDown(s.view, key("Enter"));
            await s.executing;
        } finally {
            pub.mockRestore();
            s.restore();
        }
    });

    test("restarting clears the previous tool and preview handler", () => {
        const command = new SplitFeatureCommand() as unknown as {
            tool: object | undefined;
            previewHandler: object | undefined;
            stepDatas: unknown[];
            onRestarting: () => void;
        };
        command.tool = {};
        command.previewHandler = {};
        command.stepDatas = [{}];

        command.onRestarting();

        expect(command.tool).toBeUndefined();
        expect(command.previewHandler).toBeUndefined();
        expect(command.stepDatas).toEqual([]);
    });

    test("cancelling the preview leaves the body unchanged", async () => {
        const s = scenario();
        try {
            await s.previewOpened;
            const preview = s.getPreview();
            expect(preview).toBeInstanceOf(SplitPreviewHandler);
            if (preview === undefined) throw new Error("Preview did not open");
            preview.keyDown(s.view, key("Escape"));
            await s.executing;

            expect(s.setFeatures).not.toHaveBeenCalled();
            expect(s.removeMesh).toHaveBeenCalled();
            expect(s.setVisible).toHaveBeenLastCalledWith(s.body, true);
        } finally {
            s.restore();
        }
    });
});
