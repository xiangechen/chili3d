// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IShape, Matrix4, Plane, Result, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { buildCapabilityTools, summarizeRefIds } from "../src/tools/capabilityEngine";

describe("capabilityEngine", () => {
    test("exposes a single run_program tool with the full method enum", () => {
        const tools = buildCapabilityTools();
        expect(tools.length).toBe(1);
        expect(tools[0].name).toBe("run_program");

        const props = tools[0].parameters["properties"] as Record<string, any>;
        const ops = props["ops"] as any;
        expect(ops.type).toBe("array");
        expect(ops.items.required).toEqual(["method"]);
        const methodEnum = ops.items.properties["method"].enum as string[];
        expect(methodEnum).toContain("box");
        expect(methodEnum).toContain("fillet");
        expect(methodEnum).toContain("revolve");
        expect(methodEnum).toContain("shape.volume");
        expect(methodEnum).toContain("shape.findSubShapes");
        expect(methodEnum).toContain("curve.length");
        expect(methodEnum).toContain("surface.bounds");
        expect(methodEnum).toContain("transformedMul");
        expect(methodEnum).toContain("wire.toFace");
        expect(methodEnum).toContain("wire.offset");
        expect(methodEnum).toContain("face.outerWire");
        expect(methodEnum).toContain("curve.reverse");
        expect(methodEnum).toContain("shape.matrix");
        expect(methodEnum).toContain("shape.section");
        expect(methodEnum).toContain("removeFillet");
        // fuse is hidden: it is booleanFuse without input consumption, a duplicate-geometry trap.
        expect(methodEnum).not.toContain("fuse");
    });

    test("summarizeRefIds compresses numeric runs and caps the list", () => {
        expect(summarizeRefIds(new Map())).toBe("ai.error.noRefs");

        const refs = new Map<string, never>();
        refs.set("body", undefined as never);
        refs.set("b", undefined as never);
        for (const id of ["c8", "c9", "c10"]) refs.set(id, undefined as never);
        for (let i = 0; i < 30; i++) refs.set(`e#${i}`, undefined as never);
        for (const id of ["x1", "x2"]) refs.set(id, undefined as never);
        expect(summarizeRefIds(refs)).toBe("body, b, c8..c10, e#0..e#29, x1, x2");

        const many = new Map<string, never>();
        for (let i = 0; i < 50; i++) many.set(`n${i}z`, undefined as never);
        expect(summarizeRefIds(many)).toContain("… (+10 more)");
    });

    test("transformedMul derives a moved copy without consuming the source", async () => {
        const removed: string[] = [];
        const nodes: { id: string; parent: { remove: () => void } }[] = [];
        const doc = createMockDocument();
        const addNode = rs.fn((node: any) => {
            nodes.push(node);
            node.parent = { remove: () => removed.push(node.id) };
        });
        (doc.modelManager as any).addNode = addNode;
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) => nodes.filter(pred));
        (doc.visual as any).update = rs.fn(() => {});

        const transformedMul = rs.fn((m: Matrix4) => ({ shapeType: ShapeTypes.solid, matrix: m }));
        const solid = { shapeType: ShapeTypes.solid, transformedMul };
        const box = rs.fn(() => Result.ok(solid as unknown as IShape));
        const app = createMockApplication({ shapeProvider: { factory: { box } as any } });
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildCapabilityTools()[0];
            const result = JSON.parse(
                (await tool.handler({
                    ops: [
                        { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                        {
                            id: "m",
                            method: "transformedMul",
                            args: { shape: "b", translate: { x: 5, y: 0, z: 0 } },
                        },
                    ],
                })) as string,
            );

            expect(transformedMul.mock.calls.length).toBe(1);
            expect(transformedMul.mock.calls[0][0].toArray().slice(12, 15)).toEqual([5, 0, 0]);
            expect(result.created.length).toBe(2);
            expect(result.created[1].id).toBe("m");
            expect(removed.length).toBe(0);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("transformedMul validates its args before touching the shape", async () => {
        const nodes: any[] = [];
        const doc = createMockDocument();
        (doc.modelManager as any).addNode = rs.fn((node: any) => {
            nodes.push(node);
            node.parent = { remove: () => nodes.splice(nodes.indexOf(node), 1) };
        });
        (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) => nodes.filter(pred));

        const transformedMul = rs.fn((m: Matrix4) => ({ shapeType: ShapeTypes.solid, matrix: m }));
        const solid = { shapeType: ShapeTypes.solid, transformedMul };
        const box = rs.fn(() => Result.ok(solid as unknown as IShape));
        const app = createMockApplication({ shapeProvider: { factory: { box } as any } });
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildCapabilityTools()[0];
            await expect(
                tool.handler({
                    ops: [
                        { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                        { method: "transformedMul", args: { translate: { x: 1, y: 0, z: 0 } } },
                    ],
                }),
            ).rejects.toThrow("transformedMul requires args.shape");
            await expect(
                tool.handler({
                    ops: [
                        { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                        { method: "transformedMul", args: { shape: "b" } },
                    ],
                }),
            ).rejects.toThrow("provide at least one of translate, rotate, scale, mirror");
            expect(transformedMul.mock.calls.length).toBe(0);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("executes a single-op program against the factory", async () => {
        const doc = createMockDocument();
        const addNode = rs.fn((..._nodes: unknown[]) => {});
        const update = rs.fn(() => {});
        (doc.modelManager as any).addNode = addNode;
        (doc.visual as any).update = update;

        const box = rs.fn((..._args: unknown[]) => Result.ok({} as IShape));
        const app = createMockApplication({ shapeProvider: { factory: { box } as any } });
        (app as any).activeView = { document: doc };

        rs.stubGlobal("app", app);
        try {
            const tool = buildCapabilityTools()[0];
            const result = JSON.parse(
                (await tool.handler({
                    ops: [{ id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } }],
                })) as string,
            );

            expect(box.mock.calls.length).toBe(1);
            expect(box.mock.calls[0].slice(1)).toEqual([10, 20, 5]);
            expect(result.created.length).toBe(1);
            expect(result.created[0].id).toBe("b");
            expect(addNode.mock.calls.length).toBe(1);
            expect(update.mock.calls.length).toBe(1);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("consumes referenced ops: fillet removes the box it edits", async () => {
        const removed: string[] = [];
        const nodes: { id: string; parent: { remove: () => void } }[] = [];
        const doc = createMockDocument();
        const addNode = rs.fn((node: any) => {
            nodes.push(node);
            node.parent = { remove: () => removed.push(node.id) };
        });
        const findNodes = rs.fn((pred: (n: any) => boolean) => nodes.filter(pred));
        (doc.modelManager as any).addNode = addNode;
        (doc.modelManager as any).findNodes = findNodes;

        const box = rs.fn(() => Result.ok({} as IShape));
        const fillet = rs.fn((..._args: unknown[]) => Result.ok({} as IShape));
        const app = createMockApplication({ shapeProvider: { factory: { box, fillet } as any } });
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildCapabilityTools()[0];
            const result = JSON.parse(
                (await tool.handler({
                    ops: [
                        { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                        { method: "fillet", args: { shape: "b", edges: [0], radius: 2 } },
                    ],
                })) as string,
            );

            expect(fillet.mock.calls.length).toBe(1);
            expect(removed.length).toBe(1);
            expect(addNode.mock.calls.length).toBe(2);
            expect(result.created.length).toBe(2);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("read/derive ops keep referenced nodes: combine removes nothing", async () => {
        const removed: string[] = [];
        const nodes: { id: string; parent: { remove: () => void } }[] = [];
        const doc = createMockDocument();
        const addNode = rs.fn((node: any) => {
            nodes.push(node);
            node.parent = { remove: () => removed.push(node.id) };
        });
        const findNodes = rs.fn((pred: (n: any) => boolean) => nodes.filter(pred));
        (doc.modelManager as any).addNode = addNode;
        (doc.modelManager as any).findNodes = findNodes;

        const box = rs.fn(() => Result.ok({} as IShape));
        const combine = rs.fn((..._args: unknown[]) => Result.ok({} as IShape));
        const app = createMockApplication({ shapeProvider: { factory: { box, combine } as any } });
        (app as any).activeView = { document: doc };
        rs.stubGlobal("app", app);

        try {
            const tool = buildCapabilityTools()[0];
            const result = JSON.parse(
                (await tool.handler({
                    ops: [
                        { id: "a", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                        { id: "b", method: "box", args: { dx: 4, dy: 4, dz: 4 } },
                        { method: "combine", args: { shapes: ["a", "b"] } },
                    ],
                })) as string,
            );

            expect(combine.mock.calls.length).toBe(1);
            expect(removed.length).toBe(0);
            expect(addNode.mock.calls.length).toBe(3);
            expect(result.created.length).toBe(3);
        } finally {
            rs.unstubAllGlobals();
        }
    });

    test("returns an error instead of throwing when ops is missing", async () => {
        const tool = buildCapabilityTools()[0];
        const result = JSON.parse((await tool.handler({})) as string);
        expect(result.error).toContain("ops");
    });

    describe("query ops", () => {
        function setup(factory: Record<string, unknown>) {
            const removed: string[] = [];
            const nodes: { id: string; parent: { remove: () => void } }[] = [];
            const doc = createMockDocument();
            const addNode = rs.fn((node: any) => {
                nodes.push(node);
                node.parent = { remove: () => removed.push(node.id) };
            });
            (doc.modelManager as any).addNode = addNode;
            (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) => nodes.filter(pred));
            const app = createMockApplication({ shapeProvider: { factory } as any });
            (app as any).activeView = { document: doc };
            rs.stubGlobal("app", app);
            return { removed, nodes, addNode };
        }

        async function run(ops: Record<string, unknown>[]) {
            const tool = buildCapabilityTools()[0];
            return JSON.parse((await tool.handler({ ops })) as string);
        }

        test("data queries report values under results and create no nodes", async () => {
            const volume = rs.fn(() => 12000);
            const solid = { shapeType: ShapeTypes.solid, volume };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            const { removed, addNode } = setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "v", method: "shape.volume", target: "b" },
                ]);

                expect(volume.mock.calls.length).toBe(1);
                expect(result.results.v).toBe(12000);
                expect(result.created.length).toBe(1);
                expect(addNode.mock.calls.length).toBe(1);
                expect(removed.length).toBe(0);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("toPlain normalizes math classes: boundingBox returns plain min/max", async () => {
            const solid = {
                shapeType: ShapeTypes.solid,
                boundingBox: rs.fn(() => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 5 })),
            };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "bb", method: "shape.boundingBox", target: "b" },
                ]);

                expect(result.results.bb).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 5 } });
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("shape.matrix returns the placement as a plain 16-number array", async () => {
            const solid = { shapeType: ShapeTypes.solid, matrix: Matrix4.fromTranslation(5, 6, 7) };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "m", method: "shape.matrix", target: "b" },
                ]);

                const array = (result.results.m as { array: number[] }).array;
                expect(array.length).toBe(16);
                expect(array.slice(12, 15)).toEqual([5, 6, 7]);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("wire.toFace unwraps the Result and registers a shape ref usable as a target", async () => {
            const area = rs.fn(() => 42);
            const face = { shapeType: ShapeTypes.face, area };
            const toFace = rs.fn(() => Result.ok(face as unknown as IShape));
            const wire = { shapeType: ShapeTypes.wire, toFace };
            const box = rs.fn(() => Result.ok(wire as unknown as IShape));
            const { addNode } = setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "f", method: "wire.toFace", target: "b" },
                    { id: "a", method: "face.area", target: "f" },
                ]);

                // Once for the op itself, once re-deriving ref "f" when face.area resolves it.
                expect(toFace.mock.calls.length).toBe(2);
                expect(result.results.f).toEqual({ ref: "f", kind: "shape" });
                expect(result.results.a).toBe(42);
                expect(addNode.mock.calls.length).toBe(1);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("wire.toFace failure surfaces the Result error", async () => {
            const toFace = rs.fn(() => Result.err("wire is not closed"));
            const wire = { shapeType: ShapeTypes.wire, toFace };
            const box = rs.fn(() => Result.ok(wire as unknown as IShape));
            setup({ box });
            try {
                const tool = buildCapabilityTools()[0];
                await expect(
                    tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                            { id: "f", method: "wire.toFace", target: "b" },
                        ],
                    }),
                ).rejects.toThrow("wire is not closed");
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("face.outerWire registers a shape ref that chains into wire queries", async () => {
            const edgeLoop = rs.fn(() => [{ shapeType: ShapeTypes.edge }]);
            const wire = { shapeType: ShapeTypes.wire, edgeLoop };
            const outerWire = rs.fn(() => wire);
            const face = { shapeType: ShapeTypes.face, outerWire };
            const box = rs.fn(() => Result.ok(face as unknown as IShape));
            setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "w", method: "face.outerWire", target: "b" },
                    { id: "l", method: "wire.edgeLoop", target: "w" },
                ]);

                expect(result.results.w).toEqual({ ref: "w", kind: "shape" });
                expect(result.results.l).toEqual({ count: 1, refs: ["l#0"], kind: "shape" });
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("curve.reverse mutates in place and the mutation survives ref re-resolution", async () => {
            const makeCurve = () => {
                let start = { x: 0, y: 0, z: 0 };
                let end = { x: 10, y: 0, z: 0 };
                return {
                    curveType: "trimmedCurve",
                    reverse() {
                        [start, end] = [end, start];
                    },
                    startPoint: () => start,
                };
            };
            // Like the real kernel, edge.curve hands out a fresh curve on every call.
            const edge = { shapeType: ShapeTypes.edge, curve: () => makeCurve() };
            const box = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ box });
            try {
                const first = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "c", method: "edge.curve", target: "b" },
                    { id: "r", method: "curve.reverse", target: "c" },
                    { id: "s", method: "boundedCurve.startPoint", target: "c" },
                ]);
                expect(first.results.r).toBeNull();
                expect(first.results.s).toEqual({ x: 10, y: 0, z: 0 });

                // A later program re-derives the ref from the live node: edge.curve is
                // re-run, then the recorded reverse is re-applied — same end state.
                const second = await run([{ id: "s2", method: "boundedCurve.startPoint", target: "c" }]);
                expect(second.results.s2).toEqual({ x: 10, y: 0, z: 0 });
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("shape.section accepts a plane literal or a shape ref and returns a shape ref", async () => {
            const sectionResult = { shapeType: ShapeTypes.wire };
            const section = rs.fn((_s: unknown) => sectionResult);
            const solidA = { shapeType: ShapeTypes.solid, section };
            const solidB = { shapeType: ShapeTypes.solid };
            let calls = 0;
            const box = rs.fn(() => Result.ok((calls++ === 0 ? solidA : solidB) as unknown as IShape));
            setup({ box });
            try {
                const result = await run([
                    { id: "a", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                    { id: "b", method: "box", args: { dx: 2, dy: 2, dz: 2 } },
                    {
                        id: "s1",
                        method: "shape.section",
                        target: "a",
                        args: { shape: { origin: { x: 0, y: 0, z: 5 } } },
                    },
                    { id: "s2", method: "shape.section", target: "a", args: { shape: "b" } },
                ]);

                expect(section.mock.calls.length).toBe(2);
                expect(section.mock.calls[0][0]).toBeInstanceOf(Plane);
                expect((section.mock.calls[0][0] as Plane).origin.z).toBe(5);
                expect(section.mock.calls[1][0]).toBe(solidB);
                expect(result.results.s1).toEqual({ ref: "s1", kind: "shape" });
                expect(result.results.s2).toEqual({ ref: "s2", kind: "shape" });
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("plane literals accept an optional normal and xvec", async () => {
            const solid = { shapeType: ShapeTypes.solid };
            const box = rs.fn((_p: unknown, _dx: number, _dy: number, _dz: number) =>
                Result.ok(solid as unknown as IShape),
            );
            setup({ box });
            try {
                await run([
                    {
                        id: "b1",
                        method: "box",
                        args: {
                            plane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
                            dx: 1,
                            dy: 2,
                            dz: 3,
                        },
                    },
                    {
                        id: "b2",
                        method: "box",
                        args: {
                            plane: { normal: { x: 0, y: 0, z: -1 }, xvec: { x: 0, y: 1, z: 0 } },
                            dx: 1,
                            dy: 2,
                            dz: 3,
                        },
                    },
                ]);

                const plane1 = box.mock.calls[0][0] as Plane;
                expect(plane1).toBeInstanceOf(Plane);
                expect(plane1.normal.x).toBeCloseTo(1, 6);
                // xvec omitted while unitX is parallel to the normal -> falls back to unitY.
                expect(plane1.xvec.y).toBeCloseTo(1, 6);
                const plane2 = box.mock.calls[1][0] as Plane;
                expect(plane2.normal.z).toBeCloseTo(-1, 6);
                expect(plane2.xvec.y).toBeCloseTo(1, 6);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("removeFillet consumes its input and reports newEdges as refs", async () => {
            const length = rs.fn(() => 3);
            const newEdge = { shapeType: ShapeTypes.edge, length };
            const newSolid = { shapeType: ShapeTypes.solid };
            const removeFillet = rs.fn(() =>
                Result.ok({ shape: newSolid as unknown as IShape, newEdges: [newEdge] }),
            );
            const solid = { shapeType: ShapeTypes.solid };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            const { removed } = setup({ box, removeFillet });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "rf", method: "removeFillet", args: { shape: "b", faces: [] } },
                    { id: "l", method: "edge.length", target: "rf#newEdges#0" },
                ]);

                expect(removeFillet.mock.calls.length).toBe(1);
                expect(removed.length).toBe(1);
                expect(result.created.length).toBe(2);
                // The consumed source node is reported so the model knows it no longer exists.
                expect(result.removed).toEqual([{ nodeId: result.created[0].nodeId, name: "box" }]);
                expect(result.results["rf.newEdges"]).toEqual({
                    count: 1,
                    refs: ["rf#newEdges#0"],
                    kind: "shape",
                });
                expect(result.results.l).toBe(3);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("owner mismatch rejects with a clear error", async () => {
            const edge = { shapeType: ShapeTypes.edge };
            const line = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ line });
            try {
                const tool = buildCapabilityTools()[0];
                await expect(
                    tool.handler({
                        ops: [
                            {
                                id: "e",
                                method: "line",
                                args: { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                            },
                            { id: "a", method: "face.area", target: "e" },
                        ],
                    }),
                ).rejects.toThrow("face.area requires a face target");
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("findSubShapes registers sub-shape refs usable as later targets", async () => {
            const area = rs.fn(() => 200);
            const face = { shapeType: ShapeTypes.face, area };
            const findSubShapes = rs.fn((type: number) => (type === ShapeTypes.face ? [face, face] : []));
            const solid = { shapeType: ShapeTypes.solid, findSubShapes };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "f", method: "shape.findSubShapes", target: "b", args: { subshapeType: "face" } },
                    { id: "a", method: "face.area", target: "f#1" },
                ]);

                expect(findSubShapes.mock.calls[0][0]).toBe(ShapeTypes.face);
                expect(result.results.f).toEqual({ count: 2, refs: ["f#0", "f#1"], kind: "shape" });
                expect(result.results.a).toBe(200);
                expect(area.mock.calls.length).toBe(1);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("edge.curve hands out a curve ref that curve.* queries accept", async () => {
            const length = rs.fn(() => 31.4);
            const edge = {
                shapeType: ShapeTypes.edge,
                curve: { length, curveType: "circle" },
            };
            const line = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ line });
            try {
                const result = await run([
                    {
                        id: "e",
                        method: "line",
                        args: { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
                    },
                    { id: "c", method: "edge.curve", target: "e" },
                    { id: "len", method: "curve.length", target: "c" },
                    { id: "t", method: "curve.curveType", target: "c" },
                ]);

                expect(result.results.c).toEqual({ ref: "c", kind: "curve" });
                expect(result.results.len).toBe(31.4);
                expect(result.results.t).toBe("circle");
                expect(length.mock.calls.length).toBe(1);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("curve queries auto-derive an edge ref's curve", async () => {
            const length = rs.fn(() => 31.4);
            const edge = { shapeType: ShapeTypes.edge, curve: { curveType: "trimmedCurve", length } };
            const line = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ line });
            try {
                const result = await run([
                    {
                        id: "e",
                        method: "line",
                        args: { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
                    },
                    { id: "t", method: "curve.curveType", target: "e" },
                    { id: "len", method: "curve.length", target: "e" },
                ]);

                expect(result.results.t).toBe("trimmedCurve");
                expect(result.results.len).toBe(31.4);
                expect(length.mock.calls.length).toBe(1);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("concrete curve owners auto-unwrap an edge ref to its basis curve", async () => {
            const edge = {
                shapeType: ShapeTypes.edge,
                curve: { curveType: "trimmedCurve", basisCurve: { curveType: "circle", radius: 5 } },
            };
            const line = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ line });
            try {
                const result = await run([
                    {
                        id: "e",
                        method: "line",
                        args: { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
                    },
                    { id: "r", method: "circle.radius", target: "e" },
                    { id: "c", method: "trimmedCurve.basisCurve", target: "e" },
                    { id: "t", method: "curve.curveType", target: "c" },
                ]);

                expect(result.results.r).toBe(5);
                expect(result.results.c).toEqual({ ref: "c", kind: "curve" });
                expect(result.results.t).toBe("circle");
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("surface queries auto-derive a face ref's surface", async () => {
            const bounds = rs.fn(() => "uv-bounds");
            const face = { shapeType: ShapeTypes.face, surface: { bounds } };
            const findSubShapes = rs.fn(() => [face]);
            const solid = { shapeType: ShapeTypes.solid, findSubShapes };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            setup({ box });
            try {
                const result = await run([
                    { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                    { id: "f", method: "shape.findSubShapes", target: "b", args: { subshapeType: "face" } },
                    { id: "uv", method: "surface.bounds", target: "f#0" },
                ]);

                expect(result.results.uv).toBe("uv-bounds");
                expect(bounds.mock.calls.length).toBe(1);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("mutation queries stay strict: no auto-derivation from an edge ref", async () => {
            const edge = { shapeType: ShapeTypes.edge, curve: { curveType: "trimmedCurve" } };
            const line = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ line });
            try {
                const tool = buildCapabilityTools()[0];
                await expect(
                    tool.handler({
                        ops: [
                            {
                                id: "e",
                                method: "line",
                                args: { start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
                            },
                            { id: "r", method: "curve.reverse", target: "e" },
                        ],
                    }),
                ).rejects.toThrow("curve.reverse requires a curve target, got an edge shape ref");
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("family mismatch on a shape ref names the shape type", async () => {
            const box = rs.fn(() => Result.ok({ shapeType: ShapeTypes.solid } as unknown as IShape));
            setup({ box });
            try {
                const tool = buildCapabilityTools()[0];
                await expect(
                    tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                            { id: "t", method: "curve.curveType", target: "b" },
                        ],
                    }),
                ).rejects.toThrow("curve.curveType requires a curve target, got a solid shape ref");
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("surface refs are labeled with their kind and rejected by curve queries", async () => {
            const plane = { surfaceType: "planeSurface" };
            const face = { shapeType: ShapeTypes.face, surface: plane };
            const findSubShapes = rs.fn(() => [face]);
            const solid = { shapeType: ShapeTypes.solid, findSubShapes };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            setup({ box });
            try {
                const tool = buildCapabilityTools()[0];
                const first = JSON.parse(
                    (await tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                            {
                                id: "faces",
                                method: "shape.findSubShapes",
                                target: "b",
                                args: { subshapeType: "face" },
                            },
                            { id: "s0", method: "face.surface", target: "faces#0" },
                        ],
                    })) as string,
                );
                expect(first.results.s0).toEqual({ ref: "s0", kind: "surface" });

                await expect(
                    tool.handler({ ops: [{ id: "t", method: "curve.curveType", target: "s0" }] }),
                ).rejects.toThrow("curve.curveType requires a curve target, got a surface ref");
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("query ops never consume their target: later ops can still reference it", async () => {
            const volume = rs.fn(() => 8);
            const solidA = { shapeType: ShapeTypes.solid, volume };
            const solidB = { shapeType: ShapeTypes.solid };
            const box = rs
                .fn(() => Result.ok(solidA as unknown as IShape))
                .mockReturnValueOnce(Result.ok(solidA as unknown as IShape))
                .mockReturnValueOnce(Result.ok(solidB as unknown as IShape));
            const combine = rs.fn(() => Result.ok({} as IShape));
            const { removed, addNode } = setup({ box, combine });
            try {
                const result = await run([
                    { id: "a", method: "box", args: { dx: 2, dy: 2, dz: 2 } },
                    { id: "v", method: "shape.volume", target: "a" },
                    { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                    { id: "c", method: "combine", args: { shapes: ["a", "b"] } },
                ]);

                expect(result.results.v).toBe(8);
                expect(combine.mock.calls.length).toBe(1);
                expect(removed.length).toBe(0);
                expect(addNode.mock.calls.length).toBe(3);
            } finally {
                rs.unstubAllGlobals();
            }
        });

        test("query ops require an id and a target", async () => {
            const solid = { shapeType: ShapeTypes.solid, volume: () => 1 };
            const box = rs.fn(() => Result.ok(solid as unknown as IShape));
            setup({ box });
            try {
                const tool = buildCapabilityTools()[0];
                await expect(
                    tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                            { method: "shape.volume", target: "b" },
                        ],
                    }),
                ).rejects.toThrow('query op "shape.volume" requires an id');
                await expect(
                    tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                            { id: "v", method: "shape.volume" },
                        ],
                    }),
                ).rejects.toThrow('query op "shape.volume" requires a target');
            } finally {
                rs.unstubAllGlobals();
            }
        });

        describe("argument validation", () => {
            function setup(factory: Record<string, unknown>) {
                const nodes: any[] = [];
                const doc = createMockDocument();
                (doc.modelManager as any).addNode = rs.fn((node: any) => {
                    nodes.push(node);
                    node.parent = { remove: () => nodes.splice(nodes.indexOf(node), 1) };
                });
                (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) =>
                    nodes.filter(pred),
                );
                const app = createMockApplication({ shapeProvider: { factory } as any });
                (app as any).activeView = { document: doc };
                rs.stubGlobal("app", app);
                return { nodes };
            }

            test("non-number numeric args reject with the op and param in the message", async () => {
                const box = rs.fn(() => Result.ok({} as IShape));
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [{ id: "b", method: "box", args: { dx: "10", dy: 20, dz: 5 } }],
                        }),
                    ).rejects.toThrow('op "box" (id "b") failed: dx must be a finite number, got "10"');
                    expect(box.mock.calls.length).toBe(0);
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("NaN and Infinity numeric args reject", async () => {
                const box = rs.fn(() => Result.ok({} as IShape));
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [{ id: "b", method: "box", args: { dx: Number.NaN, dy: 20, dz: 5 } }],
                        }),
                    ).rejects.toThrow("dx must be a finite number");
                    await expect(
                        tool.handler({
                            ops: [
                                {
                                    id: "b",
                                    method: "box",
                                    args: { dx: Number.POSITIVE_INFINITY, dy: 20, dz: 5 },
                                },
                            ],
                        }),
                    ).rejects.toThrow("dx must be a finite number");
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("malformed xyz args reject before reaching the factory", async () => {
                const line = rs.fn(() => Result.ok({} as IShape));
                setup({ line });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [
                                {
                                    id: "l",
                                    method: "line",
                                    args: { start: { x: 0, y: 0 }, end: { x: 1, y: 0, z: 0 } },
                                },
                            ],
                        }),
                    ).rejects.toThrow("start must be { x, y, z } with finite numbers");
                    expect(line.mock.calls.length).toBe(0);
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("enum args outside the allowed values reject", async () => {
                const makeThickSolidByJoin = rs.fn(() => Result.ok({} as IShape));
                setup({
                    box: rs.fn(() => Result.ok({ shapeType: ShapeTypes.solid } as unknown as IShape)),
                    makeThickSolidByJoin,
                });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [
                                { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                                {
                                    id: "t",
                                    method: "makeThickSolidByJoin",
                                    args: { shape: "b", openFaces: [], thickness: 1, joinType: "weld" },
                                },
                            ],
                        }),
                    ).rejects.toThrow("joinType must be one of arc|tangent|intersection");
                    expect(makeThickSolidByJoin.mock.calls.length).toBe(0);
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("omitted optional params reach the factory as undefined so its defaults apply", async () => {
                const makeThickSolidByJoin = rs.fn((..._args: unknown[]) => Result.ok({} as IShape));
                setup({
                    box: rs.fn(() => Result.ok({ shapeType: ShapeTypes.solid } as unknown as IShape)),
                    makeThickSolidByJoin,
                });
                try {
                    const tool = buildCapabilityTools()[0];
                    await tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                            {
                                id: "t",
                                method: "makeThickSolidByJoin",
                                args: { shape: "b", openFaces: [], thickness: 1, joinType: "arc" },
                            },
                        ],
                    });

                    const callArgs = makeThickSolidByJoin.mock.calls[0];
                    expect(callArgs[4]).toBeUndefined();
                    expect(callArgs[5]).toBeUndefined();
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("a curve ref used as a shape arg reports the kind mismatch", async () => {
                const edge = { shapeType: ShapeTypes.edge, curve: { curveType: "line", length: () => 1 } };
                const line = rs.fn(() => Result.ok(edge as unknown as IShape));
                const combine = rs.fn(() => Result.ok({} as IShape));
                setup({ line, combine });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [
                                {
                                    id: "e",
                                    method: "line",
                                    args: { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                                },
                                { id: "c", method: "edge.curve", target: "e" },
                                { id: "x", method: "combine", args: { shapes: ["c"] } },
                            ],
                        }),
                    ).rejects.toThrow('ref "c" is a curve, but a shape is required');
                    expect(combine.mock.calls.length).toBe(0);
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("factory failures surface as op context instead of a raw wasm trap", async () => {
                const box = rs.fn(() => {
                    throw new Error("call_indirect to a signature that does not match");
                });
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [{ id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } }],
                        }),
                    ).rejects.toThrow(
                        'op "box" (id "b") failed: call_indirect to a signature that does not match',
                    );
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("query target errors include the target ref in the message", async () => {
                const box = rs.fn(() => Result.ok({ shapeType: ShapeTypes.solid } as unknown as IShape));
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await expect(
                        tool.handler({
                            ops: [
                                { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                                { id: "a", method: "face.area", target: "b" },
                            ],
                        }),
                    ).rejects.toThrow('op "face.area" (target "b") failed: face.area requires a face target');
                } finally {
                    rs.unstubAllGlobals();
                }
            });
        });

        describe("ref persistence across calls", () => {
            function setup(factory: Record<string, unknown>) {
                const nodes: any[] = [];
                const doc = createMockDocument();
                (doc.modelManager as any).addNode = rs.fn((node: any) => {
                    nodes.push(node);
                    node.parent = { remove: () => nodes.splice(nodes.indexOf(node), 1) };
                });
                (doc.modelManager as any).findNodes = rs.fn((pred: (n: any) => boolean) =>
                    nodes.filter(pred),
                );
                const app = createMockApplication({ shapeProvider: { factory } as any });
                (app as any).activeView = { document: doc };
                rs.stubGlobal("app", app);
                return { nodes };
            }

            test("refs from an earlier call stay resolvable and re-resolve on the live shape", async () => {
                const area = rs.fn(() => 200);
                const face = { shapeType: ShapeTypes.face, area };
                const findSubShapes = rs.fn((type: number) => (type === ShapeTypes.face ? [face] : []));
                const solid = { shapeType: ShapeTypes.solid, findSubShapes };
                const box = rs.fn(() => Result.ok(solid as unknown as IShape));
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 10, dy: 20, dz: 5 } },
                            {
                                id: "faces",
                                method: "shape.findSubShapes",
                                target: "b",
                                args: { subshapeType: "face" },
                            },
                        ],
                    });

                    const second = JSON.parse(
                        (await tool.handler({
                            ops: [{ id: "a", method: "face.area", target: "faces#0" }],
                        })) as string,
                    );

                    expect(second.results.a).toBe(200);
                    // findSubShapes runs once per call: the ref re-resolves on the live shape.
                    expect(findSubShapes.mock.calls.length).toBe(2);
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("a ref whose source node was removed fails with a clear error", async () => {
                const box = rs.fn(() => Result.ok({ shapeType: ShapeTypes.solid } as unknown as IShape));
                const { nodes } = setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await tool.handler({ ops: [{ id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } }] });
                    nodes.splice(0, nodes.length);

                    await expect(
                        tool.handler({ ops: [{ id: "v", method: "shape.volume", target: "b" }] }),
                    ).rejects.toThrow('ref "b" is no longer valid: its source node was removed');
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("a sub-shape ref whose index vanishes after the shape changed fails clearly", async () => {
                const face = { shapeType: ShapeTypes.face, area: () => 1 };
                let faces = [face, face, face];
                const findSubShapes = rs.fn(() => faces);
                const solid = { shapeType: ShapeTypes.solid, findSubShapes };
                const box = rs.fn(() => Result.ok(solid as unknown as IShape));
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await tool.handler({
                        ops: [
                            { id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } },
                            {
                                id: "faces",
                                method: "shape.findSubShapes",
                                target: "b",
                                args: { subshapeType: "face" },
                            },
                        ],
                    });
                    faces = [face];

                    await expect(
                        tool.handler({ ops: [{ id: "a", method: "face.area", target: "faces#2" }] }),
                    ).rejects.toThrow('ref "faces#2" is no longer valid: its source shape changed');
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("an unknown ref fails with the unknownRef message listing available refs", async () => {
                const box = rs.fn(() => Result.ok({ shapeType: ShapeTypes.solid } as unknown as IShape));
                setup({ box });
                try {
                    const tool = buildCapabilityTools()[0];
                    await tool.handler({ ops: [{ id: "b", method: "box", args: { dx: 1, dy: 1, dz: 1 } }] });

                    await expect(
                        tool.handler({ ops: [{ id: "t", method: "curve.curveType", target: "c20" }] }),
                    ).rejects.toThrow('op "curve.curveType" (target "c20") failed: ai.error.unknownRef');
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("a query returning null marks the id null-valued; using it reports nullRef", async () => {
                const edge = { shapeType: ShapeTypes.edge, curve: null };
                const line = rs.fn(() => Result.ok(edge as unknown as IShape));
                setup({ line });
                try {
                    const tool = buildCapabilityTools()[0];
                    const first = JSON.parse(
                        (await tool.handler({
                            ops: [
                                {
                                    id: "e",
                                    method: "line",
                                    args: { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                                },
                                { id: "c", method: "edge.curve", target: "e" },
                            ],
                        })) as string,
                    );
                    expect(first.results.c).toBeNull();

                    await expect(
                        tool.handler({ ops: [{ id: "t", method: "curve.curveType", target: "c" }] }),
                    ).rejects.toThrow("ai.error.nullRef");
                } finally {
                    rs.unstubAllGlobals();
                }
            });

            test("a failed program drops the refs it registered", async () => {
                const edge = { shapeType: ShapeTypes.edge, curve: { curveType: "line", length: () => 1 } };
                const line = rs.fn(() => Result.ok(edge as unknown as IShape));
                setup({ line });
                try {
                    const tool = buildCapabilityTools()[0];
                    await tool.handler({
                        ops: [
                            {
                                id: "e",
                                method: "line",
                                args: { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                            },
                        ],
                    });

                    await expect(
                        tool.handler({
                            ops: [
                                { id: "c", method: "edge.curve", target: "e" },
                                { method: "transformedMul", args: {} },
                            ],
                        }),
                    ).rejects.toThrow("transformedMul requires args.shape");

                    await expect(
                        tool.handler({ ops: [{ id: "t", method: "curve.curveType", target: "c" }] }),
                    ).rejects.toThrow("ai.error.unknownRef");
                } finally {
                    rs.unstubAllGlobals();
                }
            });
        });

        test("concrete curve owners validate against curveType", async () => {
            const circle = { curveType: "circle", radius: 5 };
            const edge = { shapeType: ShapeTypes.edge, curve: circle };
            const line = rs.fn(() => Result.ok(edge as unknown as IShape));
            setup({ line });
            try {
                const result = await run([
                    {
                        id: "e",
                        method: "line",
                        args: { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                    },
                    { id: "c", method: "edge.curve", target: "e" },
                    { id: "r", method: "circle.radius", target: "c" },
                ]);
                expect(result.results.r).toBe(5);

                circle.curveType = "line";
                const tool = buildCapabilityTools()[0];
                await expect(
                    tool.handler({
                        ops: [
                            {
                                id: "e",
                                method: "line",
                                args: { start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
                            },
                            { id: "c", method: "edge.curve", target: "e" },
                            { id: "r", method: "circle.radius", target: "c" },
                        ],
                    }),
                ).rejects.toThrow("circle.radius requires a circle curve, got line");
            } finally {
                rs.unstubAllGlobals();
            }
        });
    });
});
