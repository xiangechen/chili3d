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
    Precision,
    PubSub,
    ShapeTypes,
    Signal,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import { captureEdgeRef } from "../src/features/edgeRef";
import type {
    ExtrudeFeatureData,
    FeatureData,
    FilletFeatureData,
    PrimitiveFeatureData,
    RibFeatureData,
} from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
import { idsOverlap } from "../src/features/trackedId";
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

describe("rib against a curved wall", () => {
    const BOSS_RADIUS = 10;
    const BOSS_HEIGHT = 30;

    /** The plate and the boss standing on it — the `fuse`d body every case below shares. */
    const plate: PrimitiveFeatureData = {
        id: "b1",
        type: "primitive",
        primitive: "box",
        dx: 80,
        dy: 40,
        dz: 10,
    };
    const boss: PrimitiveFeatureData = {
        id: "c1",
        type: "primitive",
        primitive: "cylinder",
        radius: BOSS_RADIUS,
        height: BOSS_HEIGHT,
        origin: { x: 40, y: 20, z: 10 },
        operation: "fuse",
    };

    /**
     * The bracket's own inside corner, drawn in the radial plane through the boss's axis
     * (x = 40) — but the wall is the boss's SIDE, a surface that is not parallel to the sweep.
     * Sketch (u, v) is (y, z): from the boss's silhouette at y = 30 to the plate's top at z = 10.
     */
    const GUSSET: SketchData = {
        entities: [{ id: 201, type: "line", params: [30, 18, 38, 10] }],
        constraints: [],
    };

    function bossScene(chain: SketchData = GUSSET, patch: Partial<RibFeatureData> = {}) {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const chainNode = new SketchNode({
            document: doc,
            plane: Plane.YZ.translateTo(new XYZ({ x: 40, y: 0, z: 0 })),
            data: chain,
        });
        doc.modelManager.addNode(chainNode);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                plate,
                boss,
                {
                    id: "r1",
                    type: "rib",
                    sketchId: chainNode.id,
                    entityIds: chain.entities.map((entity) => entity.id),
                    thickness: THICKNESS,
                    operation: "fuse",
                    ...patch,
                } satisfies RibFeatureData,
            ],
        });
        doc.modelManager.addNode(body);
        return { body, chainNode };
    }

    const contains = (body: ParametricBodyNode, point: XYZ) =>
        body.shape.unchecked()!.containsPoint(point, false, Precision.Distance);
    /** The boss's own lateral face — untouched before, when the rib only touched it along a line. */
    const lateralOf = (body: ParametricBodyNode) => {
        const index = faceIdsOf(body).indexOf("prim:c1:lateral");
        expect(index).toBeGreaterThanOrEqual(0);
        return facesOf(body)[index];
    };

    test("lands on the boss's side across the whole band instead of standing tangent to it", () => {
        const { body } = bossScene();
        expect(errors(body)).toEqual([undefined, undefined, undefined]);

        // The crescent between the sketch plane's tangent line (y = 30) and the boss's own
        // surface at the band's edge (y = 29.798 at x = 38): a seat measured at the sketch plane
        // alone leaves it empty, and the rib touches the boss along one generatrix only.
        expect(contains(body, new XYZ({ x: 38.5, y: 29.95, z: 14 }))).toBe(true);
        // The negative control: above the gusset's own slope the same x still holds nothing.
        expect(contains(body, new XYZ({ x: 38.5, y: 30.2, z: 19 }))).toBe(false);
    });

    test("the join takes its seat out of the boss's lateral face", () => {
        const { body } = bossScene();
        expect(lateralOf(body).area()).toBeLessThan(2 * Math.PI * BOSS_RADIUS * BOSS_HEIGHT - 10);
    });

    test("keeps the chain's name on the face the rib grows", () => {
        const { body, chainNode } = bossScene();
        expect(faceIdsOf(body)).toContain(`rib:${chainNode.id}:ent201`);
    });

    test("a thickness edit re-hugs at the new band", () => {
        const { body } = bossScene();
        setRib(body, { thickness: 6 });
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        // The band is 6 now, so its cap planes stand 3 from the sketch plane: at its edge the
        // boss's side stands at y = 29.682 and the seat has to follow it there as well.
        expect(contains(body, new XYZ({ x: 37.5, y: 29.9, z: 14 }))).toBe(true);
    });

    test("a cut or an intersect keeps the region the sketch plane bounds", () => {
        // The band's growth is only safe under a JOIN, which absorbs what it overshoots. Measured
        // before it was gated: a 4 mm cut took 4.4 mm³ out of the boss the sketch plane's region
        // never covered, a 20 mm one took 2161 mm³, and the intersects came back non-empty.
        const base = 32000 + Math.PI * BOSS_RADIUS * BOSS_RADIUS * BOSS_HEIGHT;
        const cut = bossScene(GUSSET, { operation: "cut", thickness: 20 }).body;
        expect(errors(cut)).toEqual([undefined, undefined, undefined]);
        expect(volumeOf(cut)).toBeCloseTo(base, 1);

        const common = bossScene(GUSSET, { operation: "common", thickness: 20 }).body;
        expect(errors(common)).toEqual([undefined, undefined, undefined]);
        expect(volumeOf(common)).toBeCloseTo(0, 1);
    });

    test("a chain of two collinear pieces keeps both entities' names", () => {
        // The band's union used to unify the two collinear boundary pieces into ONE edge, and the
        // prism then had one sloped face named after whichever label won (measured: `ent202`
        // vanished from every face and edge id, where a prismatic wall keeps both).
        const chain: SketchData = {
            entities: [
                { id: 201, type: "line", params: [30, 18, 34, 14] },
                { id: 202, type: "line", params: [34, 14, 38, 10] },
            ],
            constraints: [],
        };
        const { body, chainNode } = bossScene(chain);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);

        for (const id of chain.entities.map((entity) => entity.id)) {
            const wanted = `rib:${chainNode.id}:ent${id}`;
            const named = faceIdsOf(body).some(
                (faceId) => faceId !== undefined && idsOverlap(faceId, wanted),
            );
            expect(named).toBe(true);
        }
    });

    test("an extended chain still names its face after the sketch entity", () => {
        // The extension runs further than the chain here, and the prism folds chain and stub into
        // one face: a rule that keeps only the stub's synthetic name would stop a stored reference
        // to `ent201` resolving.
        const chain: SketchData = {
            entities: [{ id: 201, type: "line", params: [30, 18, 32, 16] }],
            constraints: [],
        };
        const { body, chainNode } = bossScene(chain, { extend: true });

        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        const wanted = `rib:${chainNode.id}:ent201`;
        expect(faceIdsOf(body).some((id) => id !== undefined && idsOverlap(id, wanted))).toBe(true);
    });

    test("a chain run through the boss's own material grows only the void it bounds", () => {
        // Drawn from inside the plate out through its right face, and extended to both walls: the
        // L-shaped region is the body's own material, and only the corner past where the extension
        // leaves the plate is a void. The L shape is the case the probe has to read through the
        // region's INDEXED mesh (`interiorOf`).
        const { body } = bossScene(
            { entities: [{ id: 201, type: "line", params: [31, 11, 33, 9] }], constraints: [] },
            { extend: true },
        );

        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        // The corner the chain really bounds is there ...
        expect(contains(body, new XYZ({ x: 40, y: 30.5, z: 11 }))).toBe(true);
        // ... and the material the mis-probe swept is not: a flat reading built a slab out of the
        // boss's own section, standing out beside its silhouette all the way up to the top.
        expect(contains(body, new XYZ({ x: 38.5, y: 10.1, z: 30 }))).toBe(false);
    });
});

describe("rib across a bore", () => {
    const OUTER = 570.4986204336585;
    const INNER = 480.00542458124477;
    const TALL = 419.17579934493085;

    /**
     * A CUP: the sketch's annulus extruded tall (the wall), the inner disc extruded into its
     * bottom (the plug). The sketch plane sits above the plug, so the section there is an
     * annulus — the bore is a void the chain can fill.
     */
    function cupScene(rib?: Partial<RibFeatureData>, extraLines: readonly number[][] = []) {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const circles = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: {
                entities: [
                    { id: 1, type: "circle", params: [0, 0, OUTER] },
                    { id: 2, type: "circle", params: [0, 0, INNER] },
                ],
                constraints: [],
            },
        });
        doc.modelManager.addNode(circles);
        const profiles = (circles.mesh.faces?.range ?? []).filter(
            (x) => x.shape.shapeType === ShapeTypes.face,
        );
        const profile = (index: number) => captureProfileRef(profiles[index].shape as unknown as IFace);
        // The chord crosses the bore; its ends sit inside the wall. Every line is its own chain:
        // they are drawn parallel, so no two share an endpoint.
        const lines: number[][] = [
            [-468.86860591651396, 234.5038370834115, 462.4598773814447, 234.5038370834115],
            ...extraLines,
        ];
        const chain = new SketchNode({
            document: doc,
            plane: Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z: 210 })),
            data: {
                entities: lines.map((params, index) => ({ id: index + 1, type: "line", params })),
                constraints: [],
            },
        });
        doc.modelManager.addNode(chain);
        const features: FeatureData[] = [
            {
                id: "e1",
                type: "extrude",
                sketchId: circles.id,
                depth: TALL,
                profiles: [profile(0)],
            } satisfies ExtrudeFeatureData,
            {
                id: "e2",
                type: "extrude",
                sketchId: circles.id,
                depth: 100,
                profiles: [profile(1)],
                operation: "fuse",
            } satisfies ExtrudeFeatureData,
        ];
        if (rib !== undefined) {
            features.push({
                id: "r1",
                type: "rib",
                sketchId: chain.id,
                entityIds: lines.map((_, index) => index + 1),
                thickness: 20,
                operation: "fuse",
                ...rib,
            } satisfies RibFeatureData);
        }
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return { body, chain };
    }

    test("a horizontal chord across the bore fills it instead of being called material", () => {
        // The section's arrangement has the bore as one of its bounded areas, so a 2D reading of
        // the outline called the bore's void "material" and the rib reported "does not reach".
        const aboveLine = new XYZ({ x: 0, y: 300, z: 210 });
        const cup = cupScene().body;
        expect(cup.shape.unchecked()!.containsPoint(aboveLine, false, Precision.Distance)).toBe(false);

        const body = cupScene({}).body;
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        expect(body.shape.unchecked()!.containsPoint(aboveLine, false, Precision.Distance)).toBe(true);
    });

    test("a normal extrusion grows down the bore and stops at the plug", () => {
        // The chain's ends sit INSIDE the wall, so a "distance to the first face" reads zero
        // there while the bore's middle is 110 away — the cut-and-keep-the-near-piece reading is
        // what makes the wall reach the plug (and not run on past the open top).
        const { body, chain } = cupScene({ extrusion: "normal", reverse: true });
        expect(errors(body)).toEqual([undefined, undefined, undefined]);

        const inWall = new XYZ({ x: 0, y: 234.5, z: 150 });
        const aboveChord = new XYZ({ x: 0, y: 234.5, z: 300 });
        expect(body.shape.unchecked()!.containsPoint(inWall, false, Precision.Distance)).toBe(true);
        expect(body.shape.unchecked()!.containsPoint(aboveChord, false, Precision.Distance)).toBe(false);
        // The wall's flanks still name the sketch entity they were thickened from.
        expect(faceIdsOf(body).some((id) => id !== undefined && idsOverlap(id, `rib:${chain.id}:ent1`))).toBe(
            true,
        );
    });

    test("several picked lines are separate chains, one wall each", () => {
        // A grid of stiffeners drawn in one sketch: the lines are parallel and share no endpoint,
        // so they are several runs, not one polyline. Picking them together used to fail with
        // "The rib chain is not one open run of edges".
        const { body, chain } = cupScene({ extrusion: "normal", reverse: true }, [
            [-509.0750986581102, 68.22279632669523, 521.7005523603364, 68.22279632669523],
            [-500.3084195212042, -141.5938517665117, 510.7898484345129, -141.5938517665117],
        ]);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);

        const at = (y: number, z: number) => new XYZ({ x: 0, y, z });
        // Every line's wall hangs from the sketch plane to the plug's face.
        for (const y of [234.5, 68.2, -141.6]) {
            expect(body.shape.unchecked()!.containsPoint(at(y, 150), false, Precision.Distance)).toBe(true);
            expect(body.shape.unchecked()!.containsPoint(at(y, 300), false, Precision.Distance)).toBe(false);
        }
        // Between two of them is still the bore, not one slab filling it.
        expect(body.shape.unchecked()!.containsPoint(at(0, 150), false, Precision.Distance)).toBe(false);

        // Each wall's own faces are named apart: a shared seed would let a face reference
        // captured on one stiffener resolve onto another's (the walls' bottoms are coplanar).
        // The first run keeps the sketch's seed, the rest key on their own first entity, so
        // deleting another line does not rename them.
        const bottoms = facesOf(body)
            .flatMap((face, faceIndex) => {
                const box = face.boundingBox();
                const flat = Math.abs(box.max.z - box.min.z) < 1e-6 && Math.abs(box.min.z - 210) < 1e-6;
                return flat ? [{ id: body.faceIdAt(faceIndex), y: (box.min.y + box.max.y) / 2 }] : [];
            })
            .sort((a, b) => b.y - a.y);
        expect(bottoms.map((bottom) => bottom.id)).toEqual([
            `rib:${chain.id}`,
            `rib:${chain.id}:run2`,
            `rib:${chain.id}:run3`,
        ]);
    });

    test("several picked lines in the default mode still fill the void they bound", () => {
        // Parallel mode grows IN the plane: every chord fills the bore it crosses, and the runs'
        // slabs coincide — the result is the single chord's, not an error and not a second slab.
        const single = volumeOf(cupScene({}).body);
        const { body } = cupScene({}, [
            [-509.0750986581102, 68.22279632669523, 521.7005523603364, 68.22279632669523],
            [-500.3084195212042, -141.5938517665117, 510.7898484345129, -141.5938517665117],
        ]);
        expect(errors(body)).toEqual([undefined, undefined, undefined]);
        expect(volumeOf(body)).toBe(single);
        expect(
            body.shape
                .unchecked()!
                .containsPoint(new XYZ({ x: 0, y: 300, z: 210 }), false, Precision.Distance),
        ).toBe(true);
    });
});

describe("rib normal extrusion", () => {
    /**
     * A plate z ∈ [0, 10] and a sketch plane 40 above it, with a straight chain drawn over the
     * plate. The thickness is in the plane and the material grows along the normal — the "wall
     * hanging off a sketch" (SolidWorks' `Normal to Sketch`).
     */
    function hangingScene(patch: Partial<RibFeatureData> = {}) {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const chain = new SketchNode({
            document: doc,
            plane: Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z: 50 })),
            data: { entities: [{ id: 201, type: "line", params: [10, 20, 30, 20] }], constraints: [] },
        });
        doc.modelManager.addNode(chain);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "p1", type: "primitive", primitive: "box", dx: 40, dy: 40, dz: 10 },
                {
                    id: "r1",
                    type: "rib",
                    sketchId: chain.id,
                    entityIds: [201],
                    thickness: 4,
                    extrusion: "normal",
                    reverse: true,
                    operation: "fuse",
                    ...patch,
                } satisfies RibFeatureData,
            ],
        });
        doc.modelManager.addNode(body);
        return body;
    }

    test("thickens the chain in the plane and grows it down onto the plate", () => {
        const body = hangingScene();
        expect(errors(body)).toEqual([undefined, undefined]);
        // 20 long × 4 thick × 40 from the sketch plane down to the plate's top face.
        expect(volumeOf(body)).toBe(16000 + 20 * 4 * 40);
        const inside = new XYZ({ x: 20, y: 20, z: 30 });
        const beside = new XYZ({ x: 20, y: 30, z: 30 });
        expect(body.shape.unchecked()!.containsPoint(inside, false, Precision.Distance)).toBe(true);
        expect(body.shape.unchecked()!.containsPoint(beside, false, Precision.Distance)).toBe(false);
    });

    test("a direction that meets nothing is refused, not built into the void", () => {
        // The default (+normal) faces away from the plate: there is no "next face" to land on.
        const body = hangingScene({ reverse: false });
        expect(errors(body)[1]).toBe("The rib does not reach the body");
    });

    /** The hanging plate with a chain of `data`'s lines — bent chains are the ones that need a walk. */
    function bentScene(data: SketchData) {
        const doc = new TestDocument({ application: createMockApplication() });
        doc.visual = createMockVisualWithDocument(doc) as any;
        const chain = new SketchNode({
            document: doc,
            plane: Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z: 50 })),
            data,
        });
        doc.modelManager.addNode(chain);
        const body = new ParametricBodyNode({
            document: doc,
            features: [
                { id: "p1", type: "primitive", primitive: "box", dx: 40, dy: 40, dz: 10 },
                {
                    id: "r1",
                    type: "rib",
                    sketchId: chain.id,
                    entityIds: data.entities.map((entity) => entity.id),
                    thickness: 4,
                    extrusion: "normal",
                    reverse: true,
                    operation: "fuse",
                } satisfies RibFeatureData,
            ],
        });
        doc.modelManager.addNode(body);
        return { body, chain };
    }

    test("a bent chain is mitred rather than refused", () => {
        const { body } = bentScene({
            entities: [
                { id: 201, type: "line", params: [10, 15, 20, 15] },
                { id: 202, type: "line", params: [20, 15, 20, 25] },
            ],
            constraints: [],
        });
        expect(errors(body)).toEqual([undefined, undefined]);
        expect(volumeOf(body)).toBe(16000 + (10 + 10) * 4 * 40);
    });

    test("the walk follows the drawn shape, not the order the sketch lists it", () => {
        // The sketch lists edges in creation order, which need not start at an end of the
        // polyline: a corner drawn second, or a middle segment drawn first. The walk has to run
        // both ways from wherever it starts, and carry each entity's name with its edge.
        const horizontal = { id: 201, type: "line" as const, params: [10, 15, 20, 15] };
        const vertical = { id: 202, type: "line" as const, params: [20, 15, 20, 25] };
        const natural = bentScene({ entities: [horizontal, vertical], constraints: [] });
        const swapped = bentScene({ entities: [vertical, horizontal], constraints: [] });
        expect(errors(swapped.body)).toEqual([undefined, undefined]);
        expect(volumeOf(swapped.body)).toBe(volumeOf(natural.body));

        // Each wall keeps the entity it was drawn as, whichever came first: the flank of the
        // horizontal segment (a plane at y = 13) is that entity's, and the vertical's (x = 18).
        const flanks = facesOf(swapped.body).map((face, index) => ({
            box: face.boundingBox(),
            id: swapped.body.faceIdAt(index),
        }));
        const alongHorizontal = flanks.find(
            (face) => Math.abs(face.box.min.y - 17) < 1e-6 && Math.abs(face.box.max.y - 17) < 1e-6,
        );
        const alongVertical = flanks.find(
            (face) => Math.abs(face.box.min.x - 18) < 1e-6 && Math.abs(face.box.max.x - 18) < 1e-6,
        );
        expect(alongHorizontal?.id).toBeDefined();
        expect(alongVertical?.id).toBeDefined();
        expect(idsOverlap(alongHorizontal!.id!, `rib:${swapped.chain.id}:ent201`)).toBe(true);
        expect(idsOverlap(alongVertical!.id!, `rib:${swapped.chain.id}:ent202`)).toBe(true);

        // A middle segment drawn first is one run too.
        const middleFirst = bentScene({
            entities: [vertical, horizontal, { id: 203, type: "line" as const, params: [10, 25, 20, 25] }],
            constraints: [],
        });
        expect(errors(middleFirst.body)).toEqual([undefined, undefined]);
        expect(volumeOf(middleFirst.body)).toBe(16000 + (10 + 10 + 10) * 4 * 40);

        // Two segments either side of the seed: the backward walk has to carry on from the far
        // end of the piece it just added, not from the seed's own start.
        const bothWays = bentScene({
            entities: [
                { id: 213, type: "line" as const, params: [20, 25, 30, 25] },
                { id: 212, type: "line" as const, params: [20, 15, 20, 25] },
                { id: 211, type: "line" as const, params: [10, 15, 20, 15] },
                { id: 214, type: "line" as const, params: [30, 25, 30, 35] },
            ],
            constraints: [],
        });
        expect(errors(bothWays.body)).toEqual([undefined, undefined]);
        expect(volumeOf(bothWays.body)).toBe(16000 + (10 + 10 + 10 + 10) * 4 * 40);
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
