// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IApplication,
    type ICameraController,
    type IDocument,
    Plane,
    PubSub,
    Result,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind, type SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

interface TestContext {
    app: IApplication;
    doc: IDocument;
    view: ReturnType<typeof createMockView>;
    camera: {
        cameraPosition: XYZ;
        cameraTarget: XYZ;
        cameraUp: XYZ;
        cameraType: "perspective" | "orthographic";
        lookAt: ReturnType<typeof rs.fn>;
        fitContent: ReturnType<typeof rs.fn>;
    };
    clearSelection: ReturnType<typeof rs.fn>;
    setNodeOnTop: ReturnType<typeof rs.fn>;
    oldHandler: unknown;
    restoreFactory: () => void;
}

function mockShapeFactory() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
        },
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

function setup(): TestContext {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const clearSelection = rs.fn();
    const setNodeOnTop = rs.fn();
    const doc = new TestDocument({ application: app, selection: { clearSelection } as any });
    doc.visual = createMockVisualWithDocument(doc, {
        viewHandler: { canRotate: true } as any,
        context: { setNodeOnTop },
    }) as any;
    const view = createMockView({
        document: doc,
        cameraController: camera as unknown as ICameraController,
    });
    (app as any).activeView = view;
    return {
        app,
        doc,
        view,
        camera,
        clearSelection,
        setNodeOnTop,
        oldHandler: doc.visual.eventHandler,
        restoreFactory: mockShapeFactory(),
    };
}

const DATA: SketchData = {
    entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
    constraints: [],
};

describe("SketchEditor session statics", () => {
    afterEach(() => {
        rs.restoreAllMocks();
    });

    test("enter returns the editor and makes it the active editor", () => {
        const { app, doc, view, camera, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);

            expect(SketchEditor.getActive()).toBe(editor);
            expect(SketchEditor.getActive()).toBe(editor);
            expect(camera.lookAt).toHaveBeenCalledTimes(1);
            const [eye, target] = camera.lookAt.mock.calls[0] as unknown as [XYZ, XYZ];
            const distance = camera.cameraPosition.distanceTo(camera.cameraTarget);
            expect(eye.x).toBeCloseTo(0, 6);
            expect(eye.y).toBeCloseTo(0, 6);
            expect(eye.z).toBeCloseTo(distance, 6);
            expect(target.x).toBe(0);
            expect(camera.cameraType).toBe("orthographic");
            expect(camera.fitContent).toHaveBeenCalledTimes(1);
            expect(view.workplane).toBe(node.plane);
            expect(doc.visual.eventHandler).toBeInstanceOf(SketchEventHandler);
            expect((doc.visual.viewHandler as any).canRotate).toBe(false);
            editor.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("enter clears the current selection highlight", () => {
        const { doc, clearSelection, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);

            expect(clearSelection).toHaveBeenCalledTimes(1);
            editor.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("entering a second sketch exits the first one", () => {
        const { app, doc, restoreFactory } = setup();
        try {
            const n1 = new SketchNode({ document: doc, plane: Plane.XY });
            const n2 = new SketchNode({ document: doc, plane: Plane.YZ });
            const first = SketchEditor.enter(n1);
            const exitSpy = rs.spyOn(first, "exit");

            const second = SketchEditor.enter(n2);

            expect(exitSpy).toHaveBeenCalledTimes(1);
            expect(SketchEditor.getActive()).toBe(second);
            expect(SketchEditor.getActive()).not.toBe(first);
            second.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("editing forces a hidden sketch visible and exit restores the previous visibility", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            node.visible = false; // a consumed sketch
            const undoCount = doc.history.undoCount();

            const editor = SketchEditor.enter(node);
            expect(node.visible).toBe(true);

            editor.exit();
            expect(node.visible).toBe(false);
            // The visibility round-trip of an edit session stays out of the undo history.
            expect(doc.history.undoCount()).toBe(undoCount);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("editing renders the sketch on top and exit restores normal rendering", () => {
        const { doc, setNodeOnTop, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });

            const editor = SketchEditor.enter(node);
            expect(setNodeOnTop).toHaveBeenCalledWith([node], true);

            editor.exit();
            expect(setNodeOnTop).toHaveBeenLastCalledWith([node], false);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("editor.exit commits node data and restores camera, workplane, handler", () => {
        const { app, doc, view, camera, oldHandler, restoreFactory } = setup();
        try {
            const oldWorkplane = view.workplane;
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.exit();

            expect(SketchEditor.getActive()).toBeUndefined();
            expect(SketchEditor.getActive()).toBeUndefined();
            expect(node.data.entities).toEqual([{ id: 1, type: "line", params: [0, 0, 10, 0] }]);
            expect(doc.visual.eventHandler).toBe(oldHandler);
            expect(view.workplane).toBe(oldWorkplane);
            expect(camera.cameraType).toBe("perspective");
            expect(camera.lookAt).toHaveBeenCalledTimes(2);
            expect((doc.visual.viewHandler as any).canRotate).toBe(true);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("without a session getActive is undefined and exit is a no-op", () => {
        const { app, restoreFactory } = setup();
        try {
            expect(SketchEditor.getActive()).toBeUndefined();
            SketchEditor.exit();
            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("dimension anchors are committed to node data and restored on re-enter", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.dimensionAnchors.set(id, { kind: "offset", offset: 25 });
            editor.exit();

            expect(node.data.anchors).toEqual([{ id, anchor: { kind: "offset", offset: 25 } }]);

            const reopened = SketchEditor.enter(node);
            expect(reopened.dimensionAnchors.get(id)).toEqual({ kind: "offset", offset: 25 });
            reopened.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("anchors of deleted constraints are dropped on re-enter", () => {
        const { doc, restoreFactory } = setup();
        try {
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
                constraints: [],
                anchors: [{ id: 99, anchor: { kind: "offset", offset: 25 } }],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });

            const editor = SketchEditor.enter(node);

            expect(editor.dimensionAnchors.size).toBe(0);
            editor.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("undo/redo during a session resyncs solver and anchors from node data", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.dimensionAnchors.set(id, { kind: "offset", offset: 25 });
            editor.commit();
            expect(editor.solver.toData().constraints.length).toBe(1);

            doc.history.undo();
            expect(editor.solver.toData().constraints.length).toBe(0);
            expect(editor.dimensionAnchors.size).toBe(0);

            doc.history.redo();
            expect(editor.solver.toData().constraints.length).toBe(1);
            expect(editor.dimensionAnchors.get(id)).toEqual({ kind: "offset", offset: 25 });
            editor.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("a type-flipped external ref drops its constraints, their anchors, and warns", () => {
        const { doc, restoreFactory } = setup();
        try {
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
                constraints: [],
                externalRefs: [
                    {
                        entityId: -100,
                        nodeId: "missing-src",
                        edge: {
                            kind: "line",
                            start: { x: 0, y: 5, z: 0 },
                            end: { x: 10, y: 5, z: 0 },
                        },
                        role: "reference",
                        snapshot: [0, 5, 10, 5],
                        type: "line",
                    },
                ],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });
            const editor = SketchEditor.enter(node);
            const constraintId = editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: -100, pointIndex: 0 },
                ],
            });
            editor.dimensionAnchors.set(constraintId, { kind: "offset", offset: 25 });
            const pub = rs.spyOn(PubSub.default, "pub");

            // the same ref comes back with a different entity type (line → circle):
            // the reseed cascades its constraints away untransacted
            node.setDataEmitShapeChanged({
                entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
                constraints: [],
                externalRefs: [
                    {
                        entityId: -100,
                        nodeId: "missing-src",
                        edge: {
                            kind: "circle",
                            center: { x: 5, y: 5, z: 0 },
                            radius: 3,
                            axis: { x: 0, y: 0, z: 1 },
                        },
                        role: "reference",
                        snapshot: [5, 5, 3],
                        type: "circle",
                    },
                ],
            });

            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.dimensionAnchors.size).toBe(0);
            expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.externalRefTypeChanged");
            editor.exit();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("a failed truncated replay reverts that body's rollback and warns", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            doc.modelManager.addNode(node);
            // The sketch is consumed at feature index 1, but feature 0 cannot replay
            // (its sketch is gone): rolling back to the sketch's timeline position
            // fails, so the body must stay on the full chain instead of letting
            // plane/external-ref resolution read the later geometry as capture-time.
            const body = new ParametricBodyNode({
                document: doc,
                features: [
                    { id: "e0", type: "extrude", sketchId: "missing-sketch", depth: 10 },
                    { id: "e1", type: "extrude", sketchId: node.id, depth: 10 },
                ],
            });
            doc.modelManager.addNode(body);
            const pub = rs.spyOn(PubSub.default, "pub");

            const editor = SketchEditor.enter(node);

            expect(body.rollbackIndex).toBeUndefined();
            expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.rollbackFailed");
            editor.exit();
            expect(body.rollbackIndex).toBeUndefined();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("a throwing rollback body is reverted in place and the session still starts", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            doc.modelManager.addNode(node);
            const makeBody = (id: string) => {
                const body = new ParametricBodyNode({
                    document: doc,
                    features: [{ id: `${id}-e0`, type: "extrude", sketchId: node.id, depth: 10 }],
                });
                doc.modelManager.addNode(body);
                return body;
            };
            const good = makeBody("good");
            const bad = makeBody("bad");
            const goodCalls: (number | undefined)[] = [];
            good.setRollbackIndex = (index) => {
                goodCalls.push(index);
                return true;
            };
            const badCalls: (number | undefined)[] = [];
            bad.setRollbackIndex = (index) => {
                badCalls.push(index);
                if (index !== undefined) throw new Error("rebuild exploded");
                return true;
            };
            const pub = rs.spyOn(PubSub.default, "pub");

            // The throwing body must not strand `good` (already rolled back) by
            // escaping before the rollback map reaches startSession's catch.
            const editor = SketchEditor.enter(node);

            expect(goodCalls).toEqual([0]);
            expect(badCalls).toEqual([0, undefined]);
            expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.rollbackFailed");
            expect(node.editingSession).toBe(true);

            editor.exit();
            expect(goodCalls).toEqual([0, undefined]);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("a throwing statusBarTip subscriber does not strand the rollback handoff", () => {
        const { doc, restoreFactory } = setup();
        // PubSub.pub isolates subscriber exceptions globally: the rollbackFailed
        // tip's subscriber throws here; pub must log the error, keep the other
        // tips flowing, and return normally so the rollback map still reaches
        // startSession.
        const consoleError = rs.spyOn(console, "error").mockImplementation(() => {});
        const subscriber = (tip: string) => {
            if (tip === "sketch.rollbackFailed") throw new Error("subscriber exploded");
        };
        PubSub.default.sub("statusBarTip", subscriber);
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            doc.modelManager.addNode(node);
            const makeBody = (id: string) => {
                const body = new ParametricBodyNode({
                    document: doc,
                    features: [{ id: `${id}-e0`, type: "extrude", sketchId: node.id, depth: 10 }],
                });
                doc.modelManager.addNode(body);
                return body;
            };
            const good = makeBody("good");
            const bad = makeBody("bad");
            const goodCalls: (number | undefined)[] = [];
            good.setRollbackIndex = (index) => {
                goodCalls.push(index);
                return true;
            };
            bad.setRollbackIndex = (index) => {
                if (index !== undefined) throw new Error("rebuild exploded");
                return true;
            };

            // The failing body triggers the rollbackFailed tip; its subscriber throwing
            // must not escape applyTimelineRollback — otherwise startSession's catch
            // would see no rollback map and strand `good` in its truncated state.
            const editor = SketchEditor.enter(node);

            expect(goodCalls).toEqual([0]);
            expect(node.editingSession).toBe(true);
            expect(consoleError).toHaveBeenCalledWith(
                'PubSub: a subscriber of "statusBarTip" threw',
                expect.any(Error),
            );

            editor.exit();
            expect(goodCalls).toEqual([0, undefined]);
        } finally {
            SketchEditor.exit();
            PubSub.default.remove("statusBarTip", subscriber);
            restoreFactory();
        }
    });

    test("a constructor failure after the session starts unwinds the whole session", () => {
        const { doc, view, camera, oldHandler, setNodeOnTop, restoreFactory } = setup();
        // the editor's own solve is the last stateful constructor step (the solver's
        // internal initial solve happens earlier, inside startSession)
        rs.spyOn(SketchEditor.prototype, "solve").mockImplementation(() => {
            throw new Error("solver exploded");
        });
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            node.visible = false; // a consumed sketch
            doc.modelManager.addNode(node);
            const body = new ParametricBodyNode({
                document: doc,
                features: [{ id: "e0", type: "extrude", sketchId: node.id, depth: 10 }],
            });
            doc.modelManager.addNode(body);
            const bodyCalls: (number | undefined)[] = [];
            body.setRollbackIndex = (index) => {
                bodyCalls.push(index);
                return true;
            };
            const oldWorkplane = view.workplane;

            // solve() is the last stateful constructor step; activeEditor is never
            // published, so the constructor itself must undo every earlier step.
            expect(() => SketchEditor.enter(node)).toThrow("solver exploded");

            expect(SketchEditor.getActive()).toBeUndefined();
            expect(node.editingSession).toBe(false);
            expect(bodyCalls).toEqual([0, undefined]);
            expect(camera.cameraType).toBe("perspective");
            expect(view.workplane).toBe(oldWorkplane);
            expect(doc.visual.eventHandler).toBe(oldHandler);
            expect((doc.visual.viewHandler as any).canRotate).toBe(true);
            expect(setNodeOnTop).toHaveBeenLastCalledWith([node], false);
            expect(node.visible).toBe(false);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("exit exits the active session", () => {
        const { app, doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            SketchEditor.enter(node);

            SketchEditor.exit();

            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("exit with a throwing commit still completes the session teardown", () => {
        const { doc, oldHandler, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            node.visible = false; // a consumed sketch
            const editor = SketchEditor.enter(node);
            rs.spyOn(editor, "commit").mockImplementation(() => {
                throw new Error("commit exploded");
            });

            expect(() => editor.exit()).toThrow("commit exploded");

            // the teardown must not be stranded by the commit failure
            expect(SketchEditor.getActive()).toBeUndefined();
            expect((editor as any).disposed).toBe(true);
            expect(node.editingSession).toBe(false);
            expect(node.showProfileFaces).toBe(true);
            expect(node.visible).toBe(false);
            expect(doc.visual.eventHandler).toBe(oldHandler);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });

    test("dispose restores later bodies when an earlier body's restore throws", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            doc.modelManager.addNode(node);
            const makeBody = (id: string) => {
                const body = new ParametricBodyNode({
                    document: doc,
                    features: [{ id: `${id}-e0`, type: "extrude", sketchId: node.id, depth: 10 }],
                });
                doc.modelManager.addNode(body);
                return body;
            };
            // restore order is insertion order for unrelated bodies, so bad
            // restores first and its throw must not strand good
            const bad = makeBody("bad");
            const good = makeBody("good");
            const badCalls: (number | undefined)[] = [];
            const goodCalls: (number | undefined)[] = [];
            bad.setRollbackIndex = (index) => {
                badCalls.push(index);
                if (index === undefined) throw new Error("restore exploded");
                return true;
            };
            good.setRollbackIndex = (index) => {
                goodCalls.push(index);
                return true;
            };

            const editor = SketchEditor.enter(node);
            expect(badCalls).toEqual([0]);
            expect(goodCalls).toEqual([0]);

            editor.exit();

            expect(badCalls).toEqual([0, undefined]);
            expect(goodCalls).toEqual([0, undefined]);
        } finally {
            SketchEditor.exit();
            restoreFactory();
        }
    });
});
