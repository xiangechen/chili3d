// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    type I18nKeys,
    type IEdge,
    type IFace,
    Matrix4,
    Plane,
    PubSub,
    ShapeTypes,
    Signal,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { FeatureData, FilletFeatureData, RibFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";

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

/**
 * An L bracket: a base arm 40 long and 10 deep, and a wall 10 thick and 30 tall — the shape a rib
 * is FOR. Extruded 10 along z, straddling the sketch plane, which is what puts the plane's normal
 * on the rib's thin axis.
 */
const BASE = 40;
const DEPTH = 10;
const WALL = 30;
const THICKNESS = 4;
const BRACKET_SPAN = 10;
const BRACKET_VOLUME = (BASE * DEPTH + DEPTH * (WALL - DEPTH)) * BRACKET_SPAN;
/** The inside corner the gusset fills, and the chord drawn across it. */
const CORNER = 10;
const CHORD = 18;
const GUSSET_AREA = (CHORD * CHORD) / 2;

const bracketSketch = (): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [0, 0, BASE, 0] },
        { id: 2, type: "line", params: [BASE, 0, BASE, DEPTH] },
        { id: 3, type: "line", params: [BASE, DEPTH, CORNER, DEPTH] },
        { id: 4, type: "line", params: [CORNER, DEPTH, CORNER, WALL] },
        { id: 5, type: "line", params: [CORNER, WALL, 0, WALL] },
        { id: 6, type: "line", params: [0, WALL, 0, 0] },
    ],
    constraints: [],
});

/**
 * The chord `x + y = BASE - CORNER - DEPTH + WALL` drawn from the base's top face to `toX` — the
 * full chord at toX = CORNER (the wall's face), a stopped-short one at a larger toX.
 */
const gussetChain = (toX = CORNER): SketchData => ({
    entities: [{ id: 101, type: "line", params: [CORNER + CHORD, DEPTH, toX, CORNER + CHORD + DEPTH - toX] }],
    constraints: [],
});

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const facesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
const edgesOf = (body: ParametricBodyNode) =>
    body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
/** The chain's per-feature errors. Reading `shape` first forces the lazy evaluation — the items
 *  carry nothing until the body has actually replayed its features. */
const errors = (body: ParametricBodyNode) => {
    body.shape.unchecked();
    return body.featureItems().map((x) => x.error);
};
const faceIdsOf = (body: ParametricBodyNode) => facesOf(body).map((_, i) => body.faceIdAt(i));
const edgeIdsOf = (body: ParametricBodyNode) => edgesOf(body).map((_, i) => body.edgeIdAt(i));
const volumeOf = (body: ParametricBodyNode) => round(body.shape.unchecked()!.volume());

/** A document holding the bracket sketch and the chain sketch, both on Plane.XY. */
function scene(bracket: SketchData = bracketSketch(), chain: SketchData = gussetChain()) {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const bracketNode = new SketchNode({ document: doc, plane: Plane.XY, data: bracket });
    const chainNode = new SketchNode({ document: doc, plane: Plane.XY, data: chain });
    doc.modelManager.addNode(bracketNode);
    doc.modelManager.addNode(chainNode);
    return { doc, bracketNode, chainNode };
}

/** The bracket extruded `depth` about the sketch plane — the first feature every case shares. */
function extruded(
    { doc, bracketNode }: ReturnType<typeof scene>,
    depth = BRACKET_SPAN,
    name = "e1",
): FeatureData {
    const profiles = bracketNode.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    return {
        id: name,
        type: "extrude",
        sketchId: bracketNode.id,
        depth,
        startOffset: -depth / 2,
        profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
    };
}

/** A body whose first feature extrudes the bracket, with the rib appended. */
function ribbed(
    { doc, bracketNode, chainNode }: ReturnType<typeof scene>,
    patch: Partial<RibFeatureData> = {},
    depth = BRACKET_SPAN,
): ParametricBodyNode {
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            extruded({ doc, bracketNode, chainNode }, depth),
            {
                id: "r1",
                type: "rib",
                sketchId: chainNode.id,
                entityIds: [101],
                thickness: THICKNESS,
                operation: "fuse",
                ...patch,
            } satisfies RibFeatureData,
        ],
    });
    doc.modelManager.addNode(body);
    return body;
}

const setRib = (body: ParametricBodyNode, patch: Partial<RibFeatureData>) =>
    body.setFeaturesEmitShapeChanged(
        body.features.map((f): FeatureData => (f.id === "r1" && f.type === "rib" ? { ...f, ...patch } : f)),
    );

/** Redraws the bracket deeper — which re-spans the gusset too, since the gusset rides the plane. */
const setBracket = (body: ParametricBodyNode, depth: number) =>
    body.setFeaturesEmitShapeChanged(
        body.features.map(
            (f): FeatureData =>
                f.id === "e1" && f.type === "extrude" ? { ...f, depth, startOffset: -depth / 2 } : f,
        ),
    );

/** The bracket, plus the gusset filling its corner. */
const gussetVolume = () => GUSSET_AREA * THICKNESS;
const expectedVolume = () => BRACKET_VOLUME + gussetVolume();

describe("rib feature", () => {
    test("fills the inside corner the chord is drawn across", () => {
        const body = ribbed(scene());

        expect(errors(body)).toEqual([undefined, undefined]);
        // The bracket, plus the corner triangle given the thickness along the sketch normal.
        expect(volumeOf(body)).toBe(expectedVolume());
        // The gusset reaches out of the corner the bracket leaves open.
        expect(body.shape.unchecked()!.boundingBox().max.y).toBeCloseTo(WALL);
    });

    test("gives the rib the THICKNESS along the sketch normal, not in the plane", () => {
        // The rib is the region grown IN the plane, so the thickness is what stands it off the
        // plane — the axis the whole feature turns on (see `ribRegion`). The bracket is 10 deep
        // and the rib 4, so the rib is the thinner slab, centred on the plane.
        const body = ribbed(scene());
        const gusset = facesOf(body).filter((face) => face.normal(0, 0)[1].z > 1 - 1e-6);

        expect(gusset.length).toBeGreaterThan(0);
        for (const face of gusset) {
            const box = face.boundingBox();
            // A horizontal face of the rib: 4 wide in z, and the corner triangle's size in xy.
            expect(round(box.max.z - box.min.z)).toBe(0);
        }
        const spanZ = facesOf(body).filter(
            (face) => Math.abs(face.boundingBox().max.z - THICKNESS / 2) < 1e-6,
        );
        expect(spanZ.length).toBeGreaterThan(0);
    });

    test("names what it derives, and leaves the body's own seat unnamed", () => {
        const body = ribbed(scene());

        expect(faceIdsOf(body).filter((id) => id === undefined)).toEqual([]);
        // The rib's own edge — the chord — carries its sketch entity.
        const edges = edgesOf(body);
        const chordIndex = edges.findIndex(
            (edge) => Math.abs(edge.length() - Math.hypot(CHORD, CHORD)) < 1e-6,
        );
        expect(chordIndex).toBeGreaterThanOrEqual(0);
        expect(body.edgeIdAt(chordIndex)).toBeDefined();

        // The edges where the rib MEETS the body are the body's, not the rib's: no chain entity
        // made them, and the module's rule is that a sub-shape with no derivable identity stays
        // unnamed rather than take an ordinal a rebuild could move onto another edge (see
        // `profileEdgeSeeds`). They all sit on the base's top face or the wall's face.
        // The section's own tolerance spreads a seat edge a few hundredths either side of the
        // face it lies on, so the test is "sits on", not "is exactly at".
        const near = (value: number, target: number) => Math.abs(value - target) < 0.1;
        const unnamed = edges.filter((_, index) => body.edgeIdAt(index) === undefined);
        expect(unnamed.length).toBeGreaterThan(0);
        for (const edge of unnamed) {
            const box = edge.boundingBox();
            const onBase = near(box.min.y, DEPTH) && near(box.max.y, DEPTH);
            const onWall = near(box.min.x, CORNER) && near(box.max.x, CORNER);
            expect(onBase || onWall).toBe(true);
        }
    });

    test("a thickness edit rebuilds cleanly and keeps every id", () => {
        const body = ribbed(scene());
        const before = [...faceIdsOf(body), ...edgeIdsOf(body)].sort();

        setRib(body, { thickness: 6 });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(volumeOf(body)).toBe(BRACKET_VOLUME + GUSSET_AREA * 6);
        // Sorted, not per-index: the kernel may enumerate the fused result's sub-shapes in a
        // different order, but the NAME each one carries must not change.
        expect([...faceIdsOf(body), ...edgeIdsOf(body)].sort()).toEqual(before);
    });

    test("a fillet on a gusset edge survives a bracket edit that moves it", () => {
        const body = ribbed(scene());
        // The gusset's long wall — the triangle's hypotenuse, given the thickness. Its top edge
        // runs the whole chord at the rib's own z.
        const index = edgesOf(body).findIndex(
            (edge) =>
                edge.startPoint().z === THICKNESS / 2 &&
                edge.endPoint().z === THICKNESS / 2 &&
                Math.abs(edge.length() - Math.hypot(CHORD, CHORD)) < 1e-6,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect(body.edgeIdAt(index)).toBeDefined();

        const fillet: FilletFeatureData = {
            id: "f1",
            type: "fillet",
            radius: 1,
            edges: [captureEdgeRef(edgesOf(body)[index], body.edgeIdAt(index))],
        };
        body.setFeaturesEmitShapeChanged([...body.features, fillet]);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);

        // Nothing about the rib changed, yet the bracket it fills moved — which is the whole
        // reason the ref has to resolve by id.
        setBracket(body, 14);
        expect(round(body.shape.unchecked()!.boundingBox().max.z)).toBe(7);

        // The fillet's ref has to keep resolving by id — a loss is a test failure, see
        // `test/setup.ts`.
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        const healed = body.features[2];
        expect(healed.type === "fillet" ? typeof healed.edges[0]?.edgeId : undefined).toBe("string");
    });
});

describe("rib refusals", () => {
    test("a chord that does not reach both walls encloses nothing", () => {
        // Stopped short of the wall: the region never closes, so there is no rib to make.
        const body = ribbed(scene(bracketSketch(), gussetChain(16)));

        expect(errors(body)[1]).toBe("The rib does not reach the body");
    });

    test("refuses a plane that does not cross the body", () => {
        const shared = scene();
        const body = new ParametricBodyNode({
            document: shared.doc,
            features: [
                // Lifted clear of the sketch plane entirely.
                { ...extruded(shared), startOffset: 20 } as FeatureData,
                {
                    id: "r1",
                    type: "rib",
                    sketchId: shared.chainNode.id,
                    entityIds: [101],
                    thickness: THICKNESS,
                    operation: "fuse",
                } satisfies RibFeatureData,
            ],
        });
        shared.doc.modelManager.addNode(body);

        expect(errors(body)[1]).toBe("The rib plane does not cross the body");
    });

    test("refuses a non-positive thickness", () => {
        expect(errors(ribbed(scene(), { thickness: 0 }))[1]).toBe("Rib requires a positive thickness");
        expect(errors(ribbed(scene(), { thickness: -4 }))[1]).toBe("Rib requires a positive thickness");
    });

    test("refuses a chain that needs no body to join, rather than building a wall into nothing", () => {
        const { doc, chainNode } = scene();
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                {
                    id: "r1",
                    type: "rib",
                    sketchId: chainNode.id,
                    entityIds: [101],
                    thickness: THICKNESS,
                    operation: "fuse",
                } satisfies RibFeatureData,
            ],
        });
        doc.modelManager.addNode(body);

        expect(errors(body)).toEqual(["Rib requires a preceding feature"]);
    });

    test("reports a chain whose entities are gone instead of matching a look-alike", () => {
        expect(errors(ribbed(scene(), { entityIds: [99] }))[1]).toBe(
            "The rib chain has no entities left in the sketch",
        );
    });
});

describe("rib extend to part", () => {
    /** The same chord, stopped short of the wall — what "extend profiles to part" is for. */
    const shortChain = () => gussetChain(16);
    const spanning = () => BRACKET_VOLUME + GUSSET_AREA * THICKNESS;

    test("pushes a chord drawn short of the wall out until the corner closes", () => {
        expect(errors(ribbed(scene(bracketSketch(), shortChain())))[1]).toBe(
            "The rib does not reach the body",
        );

        const body = ribbed(scene(bracketSketch(), shortChain()), { extend: true });

        expect(errors(body)).toEqual([undefined, undefined]);
        // The end reached the wall at x = 10, 6 past where the chord stopped: its legs grew from
        // 12 to 18, and the corner triangle with them.
        expect(volumeOf(body)).toBe(spanning());
    });

    test("leaves an end that already reaches the wall alone, rather than pushing it through", () => {
        const plain = ribbed(scene());
        const body = ribbed(scene(), { extend: true });

        expect(errors(body)).toEqual([undefined, undefined]);
        expect(volumeOf(body)).toBe(round(plain.shape.unchecked()!.volume()));
    });

    test("a chord run PAST the wall needs no extension — it already lands on the part", () => {
        // "The material grows until it lands on the part" cuts both ways: the piece of the chord
        // beyond the wall bounds nothing, so the same corner triangle comes out.
        const past = ribbed(scene(bracketSketch(), gussetChain(0)));

        expect(errors(past)).toEqual([undefined, undefined]);
        expect(volumeOf(past)).toBe(spanning());
    });

    test("reports an end that reaches nothing instead of building a rib that stops short", () => {
        // Clear of the bracket, with both tangents pointing away from it.
        const body = ribbed(scene(bracketSketch(), gussetChain(-100)), { extend: true });

        expect(errors(body)[1]).toBe("A rib chain end does not reach the body");
    });
});

describe("rib region classification", () => {
    /**
     * A chain drawn THROUGH the base arm's own material instead of across a void: up from the
     * bottom edge to a corner, then right to the arm's end. Both regions it bounds are the body.
     */
    const materialChain = (): SketchData => ({
        entities: [
            { id: 102, type: "line", params: [20, 0, 20, 5] },
            { id: 103, type: "line", params: [20, 5, 40, 5] },
        ],
        constraints: [],
    });

    test("a chain drawn through the body's own material grows no rib", () => {
        // The region that wraps the chain's corner is concave, and its bounding-box centre lands
        // OUTSIDE it — in the bracket's open corner, which no material face covers. A probe that
        // trusts the box then reads "not body" and builds a fin the user never asked for, inside
        // material that already fills the space; the region's own triangulation is what says
        // otherwise (see `interiorOf`).
        const body = ribbed(scene(bracketSketch(), materialChain()), { entityIds: [102, 103] });

        // The extrusion is fine and the rib refuses: the chain bounds regions, and every one of
        // them is material the body already had.
        expect(errors(body)).toEqual([undefined, "The rib does not reach the body"]);
    });
});

describe("rib chain re-pick", () => {
    /** The shallower chord's legs — half the gusset's, drawn across the same corner. */
    const SHALLOW = 14;
    const shallowVolume = (SHALLOW * SHALLOW * THICKNESS) / 2;

    /** A chain sketch holding BOTH chords, so a re-pick has a second one to switch to. */
    const twoChords = (): SketchData => ({
        entities: [
            {
                id: 101,
                type: "line",
                params: [CORNER + CHORD, DEPTH, CORNER, CORNER + CHORD + DEPTH - CORNER],
            },
            { id: 102, type: "line", params: [CORNER + SHALLOW, DEPTH, CORNER, DEPTH + SHALLOW] },
        ],
        constraints: [],
    });

    /**
     * What a re-pick needs of the document: a selection the session can watch, the sketch's edges
     * (in `shapeEntityIds` order) as the picker's answer, and an owner visual for the pre-select.
     */
    function pickScene(shared: ReturnType<typeof scene>, ...indexes: number[]) {
        const selection = {
            clearSelection: () => {},
            setSelectedShapes: rs.fn(),
            setSelectedNodes: () => {},
            onShapeChanged: new Signal<(selected: unknown[]) => void>(),
        };
        shared.doc.selection = selection as any;
        (shared.doc.application as any).activeView = { document: shared.doc };
        const owner = { node: shared.chainNode, worldTransform: () => Matrix4.identity() };
        (shared.doc.visual.context as any).getVisual = () => owner;
        const edges = shared.chainNode.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
        const picked = indexes.map((index) => ({
            shape: edges[index],
            owner,
            transform: Matrix4.identity(),
            indexes: [index],
        }));
        shared.doc.picker.pickShape = rs.fn(() => Promise.resolve(picked)) as any;
        return { selection, picked };
    }

    test("re-picks the chain onto the edge the user points at", async () => {
        const shared = scene(bracketSketch(), twoChords());
        const body = ribbed(shared, { entityIds: [101] });
        expect(volumeOf(body)).toBe(expectedVolume());
        const { selection } = pickScene(shared, 1);

        await body.reselectShapes("r1");

        // The chain is named by the entity behind the pick, not by the curve it was drawn as.
        expect(body.features[1]).toMatchObject({ type: "rib", entityIds: [102] });
        expect(errors(body)).toEqual([undefined, undefined]);
        // The shallower chord fills the smaller corner, so the rebuilt body is the one it makes.
        expect(volumeOf(body)).toBe(BRACKET_VOLUME + shallowVolume);
        // The chain the feature already names starts selected, so the pick begins from it.
        const [preSelected] = selection.setSelectedShapes.mock.calls[0] as [{ indexes: number[] }[]];
        expect(preSelected.map((x) => x.indexes[0])).toEqual([0]);
    });

    test("previews the rebuilt body live while the chain is being picked", async () => {
        const shared = scene(bracketSketch(), twoChords());
        const body = ribbed(shared, { entityIds: [101] });
        const { selection, picked } = pickScene(shared, 1);
        let whilePicking: unknown;
        shared.doc.picker.pickShape = rs.fn(() => {
            selection.onShapeChanged.emit(picked);
            whilePicking = body.features[1];
            return Promise.resolve(picked);
        }) as any;

        await body.reselectShapes("r1");

        expect(whilePicking).toMatchObject({ entityIds: [102] });
    });

    test("confirming with nothing picked cancels rather than clearing the chain", async () => {
        const shared = scene(bracketSketch(), twoChords());
        const body = ribbed(shared, { entityIds: [101] });
        pickScene(shared);
        const onToast = rs.fn((_message: I18nKeys) => {});
        PubSub.default.sub("showToast", onToast);
        const undoCount = shared.doc.history.undoCount();
        try {
            await body.reselectShapes("r1");
        } finally {
            PubSub.default.remove("showToast", onToast);
        }

        expect(onToast).toHaveBeenCalledWith("toast.select.noSelected");
        expect(body.features[1]).toMatchObject({ entityIds: [101] });
        expect(shared.doc.history.undoCount()).toBe(undoCount);
    });
});
