// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type ICommand, Plane, PubSub, Result, XYZ } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SketchLineCommand } from "../../src/sketch/commands/sketchLine";
import { SketchRectangleCommand } from "../../src/sketch/commands/sketchRectangle";
import { ToggleSketchConstruction } from "../../src/sketch/commands/sketchToggleConstruction";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import {
    profileEntities,
    SKETCH_X_AXIS_ID,
    type SketchData,
    shapeEntityIds,
} from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

describe("construction flag in the solver", () => {
    test("loadData carries the flag into entities() and toData round-trips it", () => {
        const solver = new SketchSolver(Plane.XY, {
            entities: [
                { id: 1, type: "line", params: [0, 0, 10, 0], construction: true },
                { id: 2, type: "line", params: [0, 5, 10, 5] },
            ],
            constraints: [],
        });
        try {
            expect(solver.isConstruction(1)).toBe(true);
            expect(solver.isConstruction(2)).toBe(false);
            expect(solver.toData().entities).toEqual([
                { id: 1, type: "line", params: [0, 0, 10, 0], construction: true },
                { id: 2, type: "line", params: [0, 5, 10, 5] },
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("entities without the flag round-trip without it", () => {
        // no `construction` key at all — a sketch without construction geometry must
        // serialize byte-identical, or every edit would record a phantom history entry
        const solver = new SketchSolver(Plane.XY);
        try {
            solver.addLine(0, 0, 10, 0);
            expect(solver.entities()).toEqual([{ id: 1, type: "line", params: [0, 0, 10, 0] }]);
            expect("construction" in solver.entities()[0]).toBe(false);
        } finally {
            solver.dispose();
        }
    });

    test("setConstruction toggles the flag both ways", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const id = solver.addLine(0, 0, 10, 0);
            solver.setConstruction(id, true);
            expect(solver.isConstruction(id)).toBe(true);
            expect(solver.toData().entities[0].construction).toBe(true);
            solver.setConstruction(id, false);
            expect(solver.isConstruction(id)).toBe(false);
            expect(solver.toData().entities[0]).toEqual({ id, type: "line", params: [0, 0, 10, 0] });
        } finally {
            solver.dispose();
        }
    });

    test("reset rebuilds the flag set from the new data", () => {
        const solver = new SketchSolver(Plane.XY, {
            entities: [{ id: 1, type: "line", params: [0, 0, 10, 0], construction: true }],
            constraints: [],
        });
        try {
            solver.reset({ entities: [{ id: 2, type: "line", params: [0, 5, 10, 5] }], constraints: [] });
            expect(solver.isConstruction(2)).toBe(false);
            expect(solver.toData().entities).toEqual([{ id: 2, type: "line", params: [0, 5, 10, 5] }]);
        } finally {
            solver.dispose();
        }
    });

    test("removeEntity drops the flag", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const id = solver.addLine(0, 0, 10, 0);
            solver.setConstruction(id, true);
            solver.removeEntity(id);
            expect(solver.entities()).toEqual([]);
            expect(solver.isConstruction(id)).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});

describe("shapeEntityIds / profileEntities", () => {
    const data: SketchData = {
        entities: [
            { id: 1, type: "line", params: [0, 0, 10, 0] },
            { id: 2, type: "line", params: [10, 0, 10, 10], construction: true },
            { id: 3, type: "line", params: [10, 10, 0, 10] },
        ],
        constraints: [],
        externalRefs: [
            {
                entityId: -100,
                nodeId: "src",
                edge: {} as any,
                role: "profile",
                snapshot: [0, 10, 0, 0],
                type: "line",
            },
            {
                entityId: -101,
                nodeId: "src",
                edge: {} as any,
                role: "reference",
                snapshot: [1, 1, 2, 2],
                type: "line",
            },
        ],
    };

    test("construction entities and reference externals are excluded from shape ids", () => {
        expect(shapeEntityIds(data)).toEqual([1, 3, -100]);
    });

    test("profileEntities keeps the insertion order minus construction entities", () => {
        expect(profileEntities(data).map((e) => e.id)).toEqual([1, 3]);
    });
});

describe("SketchNode construction entities", () => {
    /** Mock shapeFactory methods on globalThis, restoring the previous state afterwards. */
    function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
        Object.defineProperty(globalThis, "shapeFactory", {
            value: methods,
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

    test("construction entities build no edge; a single remaining edge is returned directly", () => {
        const lineShape = { isEqual: () => false } as any;
        const line = rs.fn((_start: XYZ, _end: XYZ) => Result.ok(lineShape));
        const combine = rs.fn((_edges: any[]) => Result.ok({ isEqual: () => false }));
        const restore = mockShapeFactory({ line, combine });
        try {
            const node = new SketchNode({
                document: createMockDocument(),
                plane: Plane.XY,
                data: {
                    entities: [
                        { id: 1, type: "line", params: [0, 0, 3, 4] },
                        { id: 2, type: "line", params: [5, 5, 6, 6], construction: true },
                    ],
                    constraints: [],
                },
            });

            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(result.unchecked()).toBe(lineShape);
            expect(line).toHaveBeenCalledTimes(1);
            const [start, end] = line.mock.calls[0] as unknown as XYZ[];
            expect([start.x, start.y, start.z]).toEqual([0, 0, 0]);
            expect([end.x, end.y, end.z]).toEqual([3, 4, 0]);
            expect(combine).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    test("an all-construction sketch combines to an empty shape", () => {
        const compoundShape = { isEqual: () => false } as any;
        const line = rs.fn((_start: XYZ, _end: XYZ) => Result.ok({ isEqual: () => false }));
        const combine = rs.fn((_edges: any[]) => Result.ok(compoundShape));
        const restore = mockShapeFactory({ line, combine });
        try {
            const node = new SketchNode({
                document: createMockDocument(),
                plane: Plane.XY,
                data: {
                    entities: [{ id: 1, type: "line", params: [0, 0, 3, 4], construction: true }],
                    constraints: [],
                },
            });

            const result = node.generateShape();

            expect(result.isOk).toBe(true);
            expect(result.unchecked()).toBe(compoundShape);
            expect(line).not.toHaveBeenCalled();
            const edges = (combine.mock.calls[0] as unknown as [any[]])[0];
            expect(edges.length).toBe(0);
        } finally {
            restore();
        }
    });
});

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    return {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 0,
    };
}

type FakeEditor = ReturnType<typeof fakeEditor>;

/** Drives executeMainTask directly with canned step points on the XY plane. */
function runCommand(command: object, editor: FakeEditor, points: [number, number][]) {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    (command as any).stepDatas = points.map(([x, y]) => ({ point: new XYZ({ x, y, z: 0 }) }));
    try {
        (command as any).executeMainTask();
    } finally {
        getActive.mockRestore();
    }
}

describe("draw commands in construction mode", () => {
    test("a line drawn in construction mode is flagged", () => {
        const editor = fakeEditor();
        try {
            const command = new SketchLineCommand();
            command.construction = true;
            runCommand(command, editor, [
                [0, 0],
                [10, 0],
            ]);
            expect(editor.solver.entities()).toEqual([
                { id: 1, type: "line", params: [0, 0, 10, 0], construction: true },
            ]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a rectangle drawn in construction mode flags all four edges", () => {
        const editor = fakeEditor();
        try {
            const command = new SketchRectangleCommand();
            command.construction = true;
            runCommand(command, editor, [
                [0, 0],
                [10, 5],
            ]);
            expect(editor.solver.entities().map((e) => e.construction)).toEqual([true, true, true, true]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("construction mode off leaves entities plain", () => {
        const editor = fakeEditor();
        try {
            runCommand(new SketchLineCommand(), editor, [
                [0, 0],
                [10, 0],
            ]);
            expect(editor.solver.entities()).toEqual([{ id: 1, type: "line", params: [0, 0, 10, 0] }]);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("ToggleSketchConstruction command", () => {
    function fakeToggleEditor() {
        const solver = new SketchSolver(Plane.XY);
        const entityQueue: (number | undefined)[] = [];
        const selected: number[] = [];
        return {
            node: { plane: Plane.XY },
            solver,
            solve: rs.fn((_fine: boolean) => {}),
            commit: rs.fn(() => {}),
            refreshExternalDisplay: rs.fn(),
            pickEntity: rs.fn((_prompt: I18nKeys) => Promise.resolve(entityQueue.shift())),
            selectedEntityIds: rs.fn((): number[] => [...selected]),
            clearEntitySelection: rs.fn(),
            entityQueue,
            selected,
        };
    }

    async function runToggle(editor: ReturnType<typeof fakeToggleEditor>) {
        const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
        try {
            await (new ToggleSketchConstruction() as ICommand).execute({
                activeView: { document: {} },
            } as any);
        } finally {
            getActive.mockRestore();
        }
    }

    test("flips picked entities between construction and profile, committing each flip", async () => {
        const editor = fakeToggleEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(0, 5, 10, 5);
            // flip `line` twice (construction → profile), `other` once, then ESC
            editor.entityQueue.push(line, line, other, undefined);

            await runToggle(editor);

            expect(editor.solver.isConstruction(line)).toBe(false);
            expect(editor.solver.isConstruction(other)).toBe(true);
            expect(editor.solver.toData().entities).toEqual([
                { id: line, type: "line", params: [0, 0, 10, 0] },
                { id: other, type: "line", params: [0, 5, 10, 5], construction: true },
            ]);
            // a commit per flip: only a commit re-evaluates the shape, so a flipped
            // entity would otherwise vanish from the display until the command ends
            expect(editor.commit).toHaveBeenCalledTimes(3);
        } finally {
            editor.solver.dispose();
        }
    });

    test("datum and external picks are skipped with the prompt republished", async () => {
        const editor = fakeToggleEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addExternalEntity({
                entityId: -100,
                nodeId: "src",
                edge: {} as any,
                role: "reference",
                snapshot: [0, 5, 10, 5],
                type: "line",
            });
            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                editor.entityQueue.push(SKETCH_X_AXIS_ID, -100, line, undefined);
                await runToggle(editor);
                // mockRestore clears the recorded calls — assert before restoring
                expect(pub).toHaveBeenCalledWith("statusBarTip", "prompt.pickConstructionEntity");
            } finally {
                pub.mockRestore();
            }

            expect(editor.solver.isConstruction(-100)).toBe(false);
            expect(editor.solver.isConstruction(line)).toBe(true);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("ESC without a flip commits nothing", async () => {
        const editor = fakeToggleEditor();
        try {
            editor.solver.addLine(0, 0, 10, 0);
            editor.entityQueue.push(undefined);

            await runToggle(editor);

            expect(editor.solver.isConstruction(1)).toBe(false);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("a current selection is flipped directly in one commit, without picking", async () => {
        const editor = fakeToggleEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(0, 5, 10, 5);
            editor.selected.push(line, other);

            await runToggle(editor);

            expect(editor.solver.isConstruction(line)).toBe(true);
            expect(editor.solver.isConstruction(other)).toBe(true);
            expect(editor.pickEntity).not.toHaveBeenCalled();
            expect(editor.clearEntitySelection).toHaveBeenCalledTimes(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("external references in the selection are skipped", async () => {
        const editor = fakeToggleEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addExternalEntity({
                entityId: -100,
                nodeId: "src",
                edge: {} as any,
                role: "reference",
                snapshot: [0, 5, 10, 5],
                type: "line",
            });
            editor.selected.push(line, -100);

            await runToggle(editor);

            expect(editor.solver.isConstruction(line)).toBe(true);
            expect(editor.solver.isConstruction(-100)).toBe(false);
            expect(editor.pickEntity).not.toHaveBeenCalled();
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a selection without toggleable entities falls back to the pick loop", async () => {
        const editor = fakeToggleEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addExternalEntity({
                entityId: -100,
                nodeId: "src",
                edge: {} as any,
                role: "reference",
                snapshot: [0, 5, 10, 5],
                type: "line",
            });
            editor.selected.push(-100);
            editor.entityQueue.push(line, undefined);

            await runToggle(editor);

            expect(editor.pickEntity).toHaveBeenCalled();
            expect(editor.solver.isConstruction(line)).toBe(true);
            expect(editor.clearEntitySelection).not.toHaveBeenCalled();
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });
});
