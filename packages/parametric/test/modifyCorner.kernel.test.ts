// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    CancelableCommand,
    CommandStore,
    CurveUtils,
    type IApplication,
    type ICommand,
    type IEdge,
    type IFace,
    type IShape,
    Matrix4,
    outwardNormalAt,
    Plane,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import {
    cornerDragOf,
    cornerFeatureOf,
    cornerRebuilt,
    ModifyFilletFeatureCommand,
} from "../src/commands/modifyCornerCommand";
import { PressPullCommand } from "../src/commands/pressPullCommand";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { FeatureData, FilletFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { idHasPrefix } from "../src/features/trackedId";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";
import "./sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

const RECT: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 40, 0] },
        { id: 2, type: "line", params: [40, 0, 40, 20] },
        { id: 3, type: "line", params: [40, 20, 0, 20] },
        { id: 4, type: "line", params: [0, 20, 0, 0] },
    ],
    constraints: [],
};

/** The 10 mm long box this test rounds an edge of. */
const BOX_HEIGHT = 10;

function scenario() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    (app as any).activeView = { document: doc };
    // A stand-in for the body's visual, so the preview has somewhere to put the ghost state; the
    // rest of the mock context is the shared no-op one, spied so the preview can be asserted on.
    const ownerVisual = { worldTransform: () => Matrix4.identity() } as any;
    doc.visual = createMockVisualWithDocument(doc, {
        context: { getVisual: () => ownerVisual } as any,
    });
    const displayMesh = rs.spyOn(doc.visual.context, "displayMesh");
    const addState = rs.spyOn(doc.visual.highlighter, "addState");
    const sketch = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: RECT });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const extrude: FeatureData = {
        id: "e1",
        type: "extrude",
        sketchId: sketch.id,
        depth: BOX_HEIGHT,
        profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
    };
    const body = new ParametricBodyNode({ document: doc, id: "b1", features: [extrude] });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { app, doc, body, displayMesh, addState, ownerVisual };
}

const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];

/** The index of the box's one vertical edge (its endpoints differ in z alone). */
function verticalEdgeIndex(body: ParametricBodyNode): number {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const index = edges.findIndex((edge) => {
        const s = edge.startPoint();
        const e = edge.endPoint();
        return Math.abs(s.x - e.x) < 1e-6 && Math.abs(s.y - e.y) < 1e-6 && Math.abs(s.z - e.z) > 1e-6;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

/**
 * Rounds the box's vertical edge with a feature of its own, capturing the ref the way the fillet
 * command does — the edge's tracked id and all, so the feature resolves by identity rather than by
 * a fingerprint that a later edit could land on something else.
 */
function roundTheEdge(body: ParametricBodyNode, radius: number): IEdge {
    const index = verticalEdgeIndex(body);
    const edge = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])[index];
    const edgeId = body.edgeIdAt(index);
    const edges = [captureEdgeRef(edge, edgeId, body.edgeIdIsShared(edgeId))];
    body.setFeaturesEmitShapeChanged([...body.features, { id: "f1", type: "fillet", radius, edges }]);
    expect(body.featureItems()[1].error).toBeUndefined();
    return edge;
}

/** The one face the feature named, with the id it was named by. */
function cornerFace(body: ParametricBodyNode, featureId: string): { index: number; face: IFace; id: string } {
    const faces = facesOf(body);
    const indexes = faces
        .map((_, index) => index)
        .filter((index) => idHasPrefix(body.faceIdAt(index) ?? "", featureId));

    expect(indexes).toHaveLength(1);
    const id = body.faceIdAt(indexes[0]);
    expect(id).toBeDefined();
    return { index: indexes[0], face: faces[indexes[0]], id: id! };
}

/** The picked face as the viewport reports it, put in the selection the command watches. */
function pickFace(
    command: ModifyFilletFeatureCommand,
    app: unknown,
    doc: TestDocument,
    body: ParametricBodyNode,
    faceIndex: number,
    point: XYZ = XYZ.zero,
): ModifyFilletFeatureCommand {
    (command as any)._application = app;
    const face = facesOf(body)[faceIndex];
    const picked = {
        shape: face,
        owner: { node: body },
        transform: Matrix4.identity(),
        indexes: [faceIndex],
        point,
    } as unknown as VisualShapeData;
    doc.selection = {
        getSelectedShapes: () => [picked],
        getSelectedNodes: () => [body],
        setSelectedShapes: rs.fn(),
        setSelectedNodes: rs.fn(),
        clearSelection: () => {},
        onShapeChanged: { sub: () => {}, remove: () => {} },
    } as any;
    (command as any).onSelectionChanged();
    return command;
}

describe("the ids a fillet leaves behind", () => {
    test("the round is named under the feature that built it, and resolves back to it", () => {
        const { body } = scenario();

        roundTheEdge(body, 2);

        const round = cornerFace(body, "f1");
        expect(round.id.startsWith("f1:")).toBe(true);
        expect(cornerFeatureOf(body, round.index)?.id).toBe("f1");
        // A quarter-cylinder of radius 2 along the 10 mm edge — the size the edit below must move.
        expect(round.face.area()).toBeCloseTo((Math.PI / 2) * 2 * BOX_HEIGHT, 3);
    });
});

describe("what a press-pull drag on a round means", () => {
    test("it asks for that much more radius, and rebuilds the chain to it", () => {
        const { body } = scenario();
        roundTheEdge(body, 2);
        const round = cornerFace(body, "f1");
        const picked = { owner: { node: body }, indexes: [round.index] } as unknown as VisualShapeData;

        const drag = cornerDragOf(picked, 3, (value) => (typeof value === "number" ? value : undefined));

        expect(drag?.feature.id).toBe("f1");
        expect(drag?.size).toBe(5);
        // The preview the gesture draws, and the size the hand-off writes, are BOTH this — so what
        // the user watched while dragging is what the command commits.
        const rebuilt = cornerRebuilt(body, drag!.feature, drag!.size!, Matrix4.identity());
        expect(rebuilt).toBeDefined();
        const areas = (rebuilt!.findSubShapes(ShapeTypes.face) as IFace[]).map((face) => face.area());
        const round5 = (Math.PI / 2) * 5 * BOX_HEIGHT;
        expect(Math.min(...areas.map((area) => Math.abs(area - round5)))).toBeLessThan(0.01);
        rebuilt!.dispose();
    });
});

describe("ModifyFilletFeatureCommand against the kernel", () => {
    test("a new radius rebuilds the round at that size, in one undo step", () => {
        const { app, doc, body } = scenario();
        roundTheEdge(body, 2);
        const cmd = pickFace(new ModifyFilletFeatureCommand(), app, doc, body, cornerFace(body, "f1").index);
        cmd.value = 4;
        const before = doc.history.undoCount();

        (cmd as any).executeMainTask();

        expect(doc.history.undoCount()).toBe(before + 1);
        expect((body.features[1] as FilletFeatureData).radius).toBe(4);
        expect(body.featureItems()[1].error).toBeUndefined();
        // The round really is twice as wide, and it is still the same feature's face.
        expect(cornerFace(body, "f1").face.area()).toBeCloseTo((Math.PI / 2) * 4 * BOX_HEIGHT, 3);
    });

    test("the preview is the rebuilt body, with the one on screen ghosted behind it", () => {
        const { app, doc, body, displayMesh, addState, ownerVisual } = scenario();
        roundTheEdge(body, 2);
        const cmd = pickFace(new ModifyFilletFeatureCommand(), app, doc, body, cornerFace(body, "f1").index);
        cmd.value = 4;

        (cmd as any).showPreview();

        expect(displayMesh).toHaveBeenCalled();
        expect(addState).toHaveBeenCalledWith(ownerVisual, VisualStates.faceTransparent, ShapeTypes.shape);
        // Nothing is written until the confirm: the body still holds the radius it had.
        expect((body.features[1] as FilletFeatureData).radius).toBe(2);
        expect(cornerFace(body, "f1").face.area()).toBeCloseTo((Math.PI / 2) * 2 * BOX_HEIGHT, 3);
    });
});

describe("the arrow the command drags", () => {
    /** A point ON the round's tessellated surface — what a viewport pick reports. */
    function pointOnRound(round: { face: IFace }): XYZ {
        const mesh = round.face.mesh.faces!;
        const range = mesh.range.find((x) => (x.shape as unknown as IFace).isSame(round.face));
        expect(range).toBeDefined();
        return new XYZ({
            x: mesh.position[range!.start * 3],
            y: mesh.position[range!.start * 3 + 1],
            z: mesh.position[range!.start * 3 + 2],
        });
    }

    test.each([2, 4])("a round of radius %i answers a unit normal, square to its own surface", (radius) => {
        // The kernel hands back the raw `D1U × D1V`, whose length IS the radius: an arrow drawn
        // along one would outrun the pointer by that factor — invisible on a planar face, whose
        // normal is already a unit vector, and glaring on a fillet.
        const { body } = scenario();
        roundTheEdge(body, radius);
        const round = cornerFace(body, "f1");
        const point = pointOnRound(round);

        const normal = outwardNormalAt(round.face, point);

        expect(normal).toBeDefined();
        expect(normal!.length()).toBeCloseTo(1, 9);
        const uv = round.face.surface().parameter(point, 1e-3);
        expect(uv).toBeDefined();
        const tangents = round.face.surface().d1(uv!.u, uv!.v);
        expect(Math.abs(normal!.dot(tangents.d1u))).toBeLessThan(1e-6);
        expect(Math.abs(normal!.dot(tangents.d1v))).toBeLessThan(1e-6);
        // And it points out of the material, away from the box it was cut into.
        expect(normal!.dot(point.sub(new XYZ({ x: 20, y: 10, z: BOX_HEIGHT / 2 })))).toBeGreaterThan(0);
    });

    test("the handle sits on the round and travels with the size, one to one", () => {
        const { app, doc, body } = scenario();
        roundTheEdge(body, 2);
        const round = cornerFace(body, "f1");
        const point = pointOnRound(round);
        const cmd = pickFace(new ModifyFilletFeatureCommand(), app, doc, body, round.index, point);
        const foot = () => {
            const data = (cmd as any).arrowData();
            return data.anchor.add(data.direction.multiply(data.value));
        };

        // The size the feature already has: the handle's foot is the point picked on the round.
        expect(foot().sub(point).length()).toBeCloseTo(0, 6);

        // Widening the round by 2 moves the foot 2 out along the normal — a direction still scaled
        // by the radius would move it 4, which is the handle running away from the pointer.
        cmd.value = 4;
        expect(foot().sub(point).length()).toBeCloseTo(2, 6);
    });
});

describe("the preview, with an offset behind the fillet", () => {
    /** The box's vertical edge rounded, one tangent wall offset, and the round's face index. */
    function offsetScenario() {
        const { app, doc, body } = scenario();
        roundTheEdge(body, 2);
        const round = cornerFace(body, "f1");
        const tangent = facesOf(body).find((face) =>
            (round.face.findSubShapes(ShapeTypes.edge) as IEdge[]).some(
                (edge) =>
                    CurveUtils.isLine(edge.curve.basisCurve) &&
                    (face.findSubShapes(ShapeTypes.edge) as IEdge[]).some((e) => e.isSame(edge)),
            ),
        );
        expect(tangent).toBeDefined();
        const wallIndex = facesOf(body).findIndex((face) => face.isSame(tangent!));
        const wallId = body.faceIdAt(wallIndex);
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "m1",
                type: "offsetFace",
                faces: [captureProfileRef(tangent!, wallId, body.faceIdIsShared(wallId))],
                distance: 3,
                keepRounds: true,
            },
        ]);
        expect(body.featureItems().map((item) => item.error)).toEqual([undefined, undefined, undefined]);
        return { app, doc, body, roundIndex: cornerFace(body, "f1").index };
    }

    const areasOf = (shape: IShape) =>
        (shape.findSubShapes(ShapeTypes.face) as IFace[]).map((face) => face.area()).sort((a, b) => a - b);

    test("a radius change previews the very shape the confirm builds", () => {
        // The preview replays the chain itself, and an Offset Face behind the fillet resolves its
        // face refs there — by identity, as the body's own run does. Without the ids threaded
        // through that replay the ref falls back to the fingerprint captured at the OLD radius, the
        // tangent wall no longer matches it, and the offset lands on the neighbouring round: a
        // preview of a bigger round than the one that gets built.
        const { app, doc, body, roundIndex } = offsetScenario();
        const cmd = pickFace(new ModifyFilletFeatureCommand(), app, doc, body, roundIndex);
        cmd.value = 4;

        const preview = cornerRebuilt(
            body,
            body.features[1] as FilletFeatureData,
            cmd.value,
            Matrix4.identity(),
        );
        expect(preview).toBeDefined();
        const previewed = areasOf(preview!);
        preview!.dispose();

        (cmd as any).executeMainTask();

        const built = areasOf(body.shape.unchecked()!);
        expect(previewed.length).toBe(built.length);
        for (const [index, area] of built.entries()) {
            expect(previewed[index]).toBeCloseTo(area, 2);
        }
    });
});

describe("an offset stacked on the round", () => {
    test("is left alone: the row edits the fillet, not the surface it left", () => {
        // An Offset Face on the round's own face is a SECOND feature acting on it, and editing the
        // fillet's radius does not undo that — the stored chain is replayed as it is written. The
        // row therefore holds the FILLET's radius while the round on screen is that plus the
        // offset; the preview shows the true consequence, which is what makes it readable.
        const { app, doc, body } = scenario();
        roundTheEdge(body, 2);
        const round = cornerFace(body, "f1");
        const id = body.faceIdAt(round.index);
        body.setFeaturesEmitShapeChanged([
            ...body.features,
            {
                id: "m1",
                type: "offsetFace",
                faces: [captureProfileRef(round.face, id, body.faceIdIsShared(id))],
                distance: 3,
                keepRounds: true,
            },
        ]);
        const roundRadius = () => {
            const area = facesOf(body)[cornerFace(body, "f1").index].area();
            return (area / BOX_HEIGHT) * (2 / Math.PI);
        };
        expect(roundRadius()).toBeCloseTo(5, 6);

        const cmd = pickFace(new ModifyFilletFeatureCommand(), app, doc, body, cornerFace(body, "f1").index);
        expect(cmd.value).toBe(2);
        cmd.value = 4;
        (cmd as any).executeMainTask();

        expect((body.features[1] as FilletFeatureData).radius).toBe(4);
        expect(roundRadius()).toBeCloseTo(7, 6);
    });
});

/** The vertical edge whose corner sits at (x, y) — a chamfer needs to know which one it cuts. */
function cornerEdgeIndex(body: ParametricBodyNode, x: number, y: number): number {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const index = edges.findIndex((edge) => {
        const s = edge.startPoint();
        const e = edge.endPoint();
        return (
            Math.abs(s.x - e.x) < 1e-6 &&
            Math.abs(s.y - e.y) < 1e-6 &&
            Math.abs(s.z - e.z) > 1e-6 &&
            Math.abs(s.x - x) < 1e-6 &&
            Math.abs(s.y - y) < 1e-6
        );
    });
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}

/** Chamfers the vertical edge at (x, y) with a feature of its own, `mode` and all. */
function chamferTheEdge(
    body: ParametricBodyNode,
    x: number,
    y: number,
    distance: number,
    mode?: "twoDistance",
): void {
    const index = cornerEdgeIndex(body, x, y);
    const edge = (body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[])[index];
    const edgeId = body.edgeIdAt(index);
    body.setFeaturesEmitShapeChanged([
        ...body.features,
        {
            id: "c1",
            type: "chamfer",
            distance,
            ...(mode === undefined ? {} : { mode, distance2: distance / 2 }),
            edges: [captureEdgeRef(edge, edgeId, body.edgeIdIsShared(edgeId))],
        },
    ]);
    expect(body.featureItems().at(-1)!.error).toBeUndefined();
}

/**
 * Where the flat a chamfer left sits from the edge at (x, y) it cut off, measured along the flat's
 * own outward normal — the distance a press-pull drag is asking to change. A positive move is
 * outward, away from the material.
 */
function flatOffset(body: ParametricBodyNode, x: number, y: number): number {
    const faces = facesOf(body);
    const index = faces.findIndex((_, i) => idHasPrefix(body.faceIdAt(i) ?? "", "c1"));
    expect(index).toBeGreaterThanOrEqual(0);
    return planeOffsetFrom(faces[index], x, y);
}

/** The same measurement on a bare rebuilt shape, which carries no tracked ids to find the flat by. */
function flatOffsetOf(shape: IShape, x: number, y: number): number {
    const found = (shape.findSubShapes(ShapeTypes.face) as IFace[]).filter((face) => {
        if (!face.surface().isPlanar()) return false;
        const n = face.normal(0, 0)[1];
        return Math.abs(n.x) > 1e-6 && Math.abs(n.y) > 1e-6;
    });
    expect(found).toHaveLength(1);
    return planeOffsetFrom(found[0], x, y);
}

function planeOffsetFrom(flat: IFace, x: number, y: number): number {
    const normal = flat.normal(0, 0)[1];
    const box = flat.boundingBox();
    const centre = new XYZ({
        x: 0.5 * (box.min.x + box.max.x),
        y: 0.5 * (box.min.y + box.max.y),
        z: 0.5 * (box.min.z + box.max.z),
    });
    return (centre.x - x) * normal.x + (centre.y - y) * normal.y;
}

describe("what a press-pull drag on a chamfer means", () => {
    test("it asks for a chamfer that much smaller, and the flat lands where the hand went", () => {
        const { body } = scenario();
        chamferTheEdge(body, 0, 0, 3);
        const flat = cornerFace(body, "c1");
        const picked = {
            shape: flat.face,
            owner: { node: body },
            indexes: [flat.index],
        } as unknown as VisualShapeData;
        const before = flatOffset(body, 0, 0);

        const drag = cornerDragOf(picked, 1, (value) => (typeof value === "number" ? value : undefined));

        expect(drag?.feature.id).toBe("c1");
        // A 90-degree corner: the flat's plane sits `distance * cos(45)` from the edge, so a 1 mm
        // move OUT is a chamfer 1/cos(45) = sqrt(2) smaller — the body grows, the cut shrinks.
        expect(drag?.size).toBeCloseTo(3 - Math.SQRT2, 6);

        // The promise itself: rebuild at the size the drag asked for, and the flat is exactly the
        // 1 mm the hand moved it by. Positive is outward, so the offset went UP.
        const rebuilt = cornerRebuilt(body, drag!.feature, drag!.size!, Matrix4.identity());
        expect(rebuilt).toBeDefined();
        const after = flatOffsetOf(rebuilt!, 0, 0);
        expect(after - before).toBeCloseTo(1, 6);
        rebuilt!.dispose();
    });

    test("an asymmetric chamfer is left unpromised — the caller asks instead of guessing", () => {
        const { body } = scenario();
        chamferTheEdge(body, 0, 0, 3, "twoDistance");
        const flat = cornerFace(body, "c1");
        const picked = {
            shape: flat.face,
            owner: { node: body },
            indexes: [flat.index],
        } as unknown as VisualShapeData;

        const drag = cornerDragOf(picked, 1, (value) => (typeof value === "number" ? value : undefined));

        expect(drag?.feature.id).toBe("c1");
        expect(drag?.size).toBeUndefined();
    });
});

describe("what the chamfer hand-off does with the drag", () => {
    test("it hands over the dragged size SETTLED, so the user confirms once and not twice", async () => {
        const { app, doc, body } = scenario();
        chamferTheEdge(body, 0, 0, 3);
        const flat = cornerFace(body, "c1");
        const picked = {
            shape: flat.face,
            owner: { node: body },
            indexes: [flat.index],
        } as unknown as VisualShapeData;

        // The command Press Pull opens, standing in for the real one — what matters here is
        // whether it is told the pick and the size are already answered.
        let settledFlag: boolean | undefined;
        class Target implements ICommand {
            pickSettled?: boolean;
            async execute(): Promise<void> {
                settledFlag = this.pickSettled;
            }
        }
        const getCommand = rs.spyOn(CommandStore, "getCommand").mockReturnValue(Target);
        const seed = rs.spyOn(CancelableCommand, "seedOptions");
        try {
            (doc as any).selection = {
                getSelectedShapes: () => [],
                getSelectedNodes: () => [],
                setSelectedShapes: rs.fn(),
                clearSelection: () => {},
            };
            const cmd = new PressPullCommand();
            (cmd as any)._application = app;
            (cmd as any).stepDatas = [{ shapes: [picked], nodes: [body], type: "input", distance: 1 }];

            expect((cmd as any).stepDatas[0].shapes).toHaveLength(1);
            await (cmd as any).openFromPick();

            // Read before the spies come off: `mockRestore` clears what was recorded.
            expect(getCommand).toHaveBeenCalledWith("feature.modifyChamfer");
            // `settled: true` is what makes the target skip its own pick — one confirm for the whole
            // gesture. It is only honest because the size went with it.
            expect(settledFlag).toBe(true);
            expect(seed).toHaveBeenCalledTimes(1);
            expect(seed.mock.calls[0][0]).toBe("feature.modifyChamfer");
            // `3 - distance / cos(45)`, through `1 / sqrt(1/2)` rather than the literal `sqrt(2)` —
            // a last-digit apart, which is why this is a closeness and not an equality.
            expect((seed.mock.calls[0][1] as { value: number }).value).toBeCloseTo(3 - Math.SQRT2, 9);
            expect((doc as any).selection.setSelectedShapes).toHaveBeenCalled();
        } finally {
            getCommand.mockRestore();
            seed.mockRestore();
        }
    });
});
