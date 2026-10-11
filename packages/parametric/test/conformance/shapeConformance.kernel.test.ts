// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { expectArea, round } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../../src/features/edgeRef";
import type {
    BooleanFeatureData,
    ChamferFeatureData,
    DraftFeatureData,
    ExtrudeFeatureData,
    FeatureData,
    FilletFeatureData,
    LoftFeatureData,
    RevolveFeatureData,
    ShellFeatureData,
    SweepFeatureData,
    ThickenFeatureData,
} from "../../src/features/feature";
import { captureProfileRef } from "../../src/features/profileRef";
import type { ParametricBodyNode } from "../../src/parametricBodyNode";
import {
    addSketch,
    bodyWith,
    circle,
    edgesOf,
    expectBodyVolume,
    facesOf,
    newDocument,
    profileOf,
    rect,
    scene,
    topFaceIndex,
    WASM_BINARY,
} from "./_scene";

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

// ---------------------------------------------------------------------------------------------
// Feature builders: one per operation, so a case states its closed form and its parameters
// and nothing else.

function extrude(
    { doc, sketchNode }: ReturnType<typeof scene>,
    patch: Partial<ExtrudeFeatureData> & { depth: number },
): ParametricBodyNode {
    void doc;
    return bodyWith({ doc, sketchNode }, [
        {
            id: "e1",
            type: "extrude",
            sketchId: sketchNode.id,
            profiles: [captureProfileRef(profileOf(sketchNode))],
            ...patch,
        } satisfies ExtrudeFeatureData,
    ]);
}

function revolve(
    { doc, sketchNode }: ReturnType<typeof scene>,
    patch: Partial<RevolveFeatureData> & { axis: RevolveFeatureData["axis"]; angle: number },
): ParametricBodyNode {
    return bodyWith({ doc, sketchNode }, [
        {
            id: "r1",
            type: "revolve",
            sketchId: sketchNode.id,
            profiles: [captureProfileRef(profileOf(sketchNode))],
            ...patch,
        } satisfies RevolveFeatureData,
    ]);
}

/** Appends `<feature>` to `body`'s chain, keeping what came before it. */
function then(body: ParametricBodyNode, feature: FeatureData): ParametricBodyNode {
    body.setFeaturesEmitShapeChanged([...body.features, feature]);
    return body;
}

/** The face ref a shell/draft takes — captured before the feature that removes the face runs. */
function faceRef(body: ParametricBodyNode, index: number) {
    const face = facesOf(body)[index];
    return captureProfileRef(face, body.faceIdAt(index), body.faceIdIsShared(body.faceIdAt(index)));
}

function edgeRef(body: ParametricBodyNode, index: number) {
    const edge = edgesOf(body)[index];
    return captureEdgeRef(edge, body.edgeIdAt(index));
}

// ---------------------------------------------------------------------------------------------

describe("conformance: extrude", () => {
    test("a 40×30 rectangle extruded 20 is a box of dx·dy·h", () => {
        expectBodyVolume(extrude(scene(rect(-20, -15, 20, 15)), { depth: 20 }), 40 * 30 * 20);
    });

    test("depth scales the volume linearly, and the sign of the direction does not change it", () => {
        expectBodyVolume(extrude(scene(rect(-20, -15, 20, 15)), { depth: 5 }), 40 * 30 * 5);
        expectBodyVolume(extrude(scene(rect(-20, -15, 20, 15)), { depth: -5 }), 40 * 30 * 5);
    });

    test("symmetric doubles the depth about the profile plane", () => {
        expectBodyVolume(
            extrude(scene(rect(-20, -15, 20, 15)), { depth: 20, symmetric: true }),
            40 * 30 * 40,
        );
    });

    test("a starting offset moves the prism without changing its volume", () => {
        expectBodyVolume(extrude(scene(rect(-20, -15, 20, 15)), { depth: 20, startOffset: 7 }), 40 * 30 * 20);
    });
});

describe("conformance: revolve", () => {
    // A 10×5 rectangle standing 10 clear of the Y axis, turned about it: an annulus.
    // Its volume is the ring's cross-section, π(R₂² − R₁²), times its height.
    const annulus = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } };

    test("a full turn about an axis clear of the profile is π(R₂² − R₁²)·h", () => {
        const body = revolve(scene(rect(10, 0, 15, 10)), { axis: annulus, angle: 360 });
        expectBodyVolume(body, Math.PI * (15 ** 2 - 10 ** 2) * 10);
    });

    test("a quarter turn is that ring's quarter", () => {
        const body = revolve(scene(rect(10, 0, 15, 10)), { axis: annulus, angle: 90 });
        expectBodyVolume(body, (Math.PI * (15 ** 2 - 10 ** 2) * 10) / 4);
    });
});

describe("conformance: shell", () => {
    // A 40×30×20 plate with its top face open and a t mm wall: the wall thickness comes
    // off both the footprint and the height, so the cavity is (40−2t)(30−2t)(20−t).
    const plate = (thickness: number) => {
        const built = extrude(scene(rect(-20, -15, 20, 15)), { depth: 20 });
        const top = faceRef(built, topFaceIndex(built));
        return then(built, { id: "s1", type: "shell", faces: [top], thickness } satisfies ShellFeatureData);
    };

    test("a 2mm wall on a 40×30×20 plate leaves the cavity the wall removes", () => {
        expectBodyVolume(plate(2), 40 * 30 * 20 - 36 * 26 * 18);
    });

    test("a 3mm wall leaves the cavity that thickness removes", () => {
        expectBodyVolume(plate(3), 40 * 30 * 20 - 34 * 24 * 17);
    });
});

describe("conformance: fillet and chamfer", () => {
    // A vertical edge of the 40×30×20 box, rounded by r: a right-angle corner loses the
    // square's complement-of-quarter-disc, (1 − π/4)r², along the edge's length.
    const boxWith = (r: number, kind: "fillet" | "chamfer") => {
        const built = extrude(scene(rect(-20, -15, 20, 15)), { depth: 20 });
        // The four vertical edges are the only ones 20 long on a 40×30×20 box.
        const vertical = edgesOf(built).findIndex((edge) => round(edge.length()) === 20);
        const ref = edgeRef(built, vertical);
        const feature: FeatureData =
            kind === "fillet"
                ? ({ id: "f1", type: "fillet", radius: r, edges: [ref] } satisfies FilletFeatureData)
                : ({ id: "c1", type: "chamfer", distance: r, edges: [ref] } satisfies ChamferFeatureData);
        return then(built, feature);
    };

    test("an r=4 fillet on one 20mm vertical edge removes (1 − π/4)·r²·L", () => {
        expectBodyVolume(boxWith(4, "fillet"), 40 * 30 * 20 - (1 - Math.PI / 4) * 4 ** 2 * 20);
    });

    test("a 4mm equal-distance chamfer removes the half-square d²/2 along the edge", () => {
        expectBodyVolume(boxWith(4, "chamfer"), 40 * 30 * 20 - (4 ** 2 / 2) * 20);
    });
});

describe("conformance: area", () => {
    // A face's area is a closed form the volume cannot stand in for: a shell's opening, a
    // boolean's cut face. Read through `expectArea`, which takes the face interface — the
    // volume reading is on every shape, the area reading is not.
    test("the opening a 40×30×20 plate's shell leaves is the rim's area minus the cavity's", () => {
        const built = extrude(scene(rect(-20, -15, 20, 15)), { depth: 20 });
        const top = faceRef(built, topFaceIndex(built));
        const shelled = then(built, {
            id: "s1",
            type: "shell",
            faces: [top],
            thickness: 2,
        } satisfies ShellFeatureData);

        // The top face is gone; the rim it left is the plate's footprint less the cavity's.
        const rim = facesOf(shelled).find((face) => Math.abs(face.normal(0, 0)[1].z - 1) < 1e-6);
        expect(rim).toBeDefined();
        expectArea(rim!, 40 * 30 - 36 * 26);
    });
});

describe("conformance: boolean", () => {
    // Two 40×30 boxes overlapping by a known amount, combined three ways. The
    // identities are what make these closed forms rather than three copied numbers:
    // |A∪B| + |A∩B| = |A| + |B|, and |A−B| = |A| − |A∩B|.
    function pair(operation: "fuse" | "cut" | "common") {
        const doc = newDocument();
        const lower = addSketch(doc, rect(-20, -15, 20, 15));
        const upper = addSketch(doc, rect(0, -15, 40, 15));
        const target = bodyWith({ doc, sketchNode: lower }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: lower.id,
                profiles: [captureProfileRef(profileOf(lower))],
                depth: 10,
            } satisfies ExtrudeFeatureData,
        ]);
        const tool = bodyWith({ doc, sketchNode: upper }, [
            {
                id: "e2",
                type: "extrude",
                sketchId: upper.id,
                profiles: [captureProfileRef(profileOf(upper))],
                depth: 10,
            } satisfies ExtrudeFeatureData,
        ]);
        return then(target, {
            id: "b1",
            type: "boolean",
            operation,
            toolIds: [tool.id],
            consumeTools: false,
        } satisfies BooleanFeatureData);
    }

    // 40×30 each, shifted 20 in x: they overlap over 20×30.
    const a = 40 * 30 * 10;
    const b = 40 * 30 * 10;
    const both = 20 * 30 * 10;

    test("a union is |A| + |B| − |A∩B|", () => {
        expectBodyVolume(pair("fuse"), a + b - both);
    });

    test("an intersection is the overlap itself", () => {
        expectBodyVolume(pair("common"), both);
    });

    test("a difference is |A| − |A∩B|", () => {
        expectBodyVolume(pair("cut"), a - both);
    });
});

describe("conformance: thicken", () => {
    test("a plate thickened by t gains t·area on the face's own side", () => {
        const doc = newDocument();
        const sketchNode = addSketch(doc, rect(-20, -15, 20, 15));
        const plate = bodyWith({ doc, sketchNode }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketchNode.id,
                profiles: [captureProfileRef(profileOf(sketchNode))],
                depth: 10,
            } satisfies ExtrudeFeatureData,
        ]);
        const top = faceRef(plate, topFaceIndex(plate));
        const thick = bodyWith({ doc, sketchNode }, [
            {
                id: "t1",
                type: "thicken",
                source: { nodeId: plate.id, profiles: [top] },
                thickness: 4,
            } satisfies ThickenFeatureData,
        ]);
        expectBodyVolume(thick, 40 * 30 * 4);
    });
});

describe("conformance: draft", () => {
    // A 40×30×20 box with its four sides tapered about the base. Each side rotates about
    // its own bottom edge, so at height z the sides have drawn in by z·tan(θ) on every
    // side: the cross-section is (a − 2z·tan θ)(b − 2z·tan θ). That varies QUADRATICALLY
    // in z — the sections are not similar (a constant amount comes off each side, not a
    // constant fraction), so the frustum rule h(A₁ + A₂ + √(A₁A₂))/3 does not apply. The
    // volume is the integral of the section, ab·h − (a + b)·t·h² + (4/3)t²h³.
    const drafted = (angle: number) => {
        const built = extrude(scene(rect(-20, -15, 20, 15)), { depth: 20 });
        const sides = facesOf(built)
            .map((face, index) => ({ face, index }))
            .filter(({ face }) => Math.abs(face.normal(0, 0)[1].z) < 1e-6)
            .map(({ index }) => faceRef(built, index));
        return then(built, {
            id: "d1",
            type: "draft",
            faces: sides,
            neutralPlane: { kind: "datum", name: "XY" },
            angle,
        } satisfies DraftFeatureData);
    };

    const taperedBox = (a: number, b: number, h: number, degrees: number) => {
        const t = Math.tan((degrees * Math.PI) / 180);
        return a * b * h - (a + b) * t * h ** 2 + (4 / 3) * t ** 2 * h ** 3;
    };

    test("a 0° draft changes nothing", () => {
        expectBodyVolume(drafted(0), 40 * 30 * 20);
    });

    test("a 10° taper leaves the volume the tapering section integrates to", () => {
        expectBodyVolume(drafted(10), taperedBox(40, 30, 20, 10));
    });

    test("the same form reproduces the 40×40×20 box at 5° the draft feature documents", () => {
        // `draft.ts` records 29282 as the measured volume for that case, from OCCT's own
        // side-of-the-neutral-plane rule. Re-deriving it here is what ties this suite's
        // formula to the kernel's measured behaviour rather than to the formula alone.
        expect(taperedBox(40, 40, 20, 5)).toBeCloseTo(29282, 0);
    });
});

describe("conformance: loft", () => {
    test("two equal squares h apart loft to the prism between them", () => {
        const doc = newDocument();
        const bottom = addSketch(doc, rect(-20, -15, 20, 15));
        const top = addSketch(doc, rect(-20, -15, 20, 15), Plane.XY.offsetAlongNormal(20));
        const body = bodyWith({ doc, sketchNode: bottom }, [
            {
                id: "l1",
                type: "loft",
                sections: [
                    { kind: "profile", nodeId: bottom.id, profile: captureProfileRef(profileOf(bottom)) },
                    { kind: "profile", nodeId: top.id, profile: captureProfileRef(profileOf(top)) },
                ],
                isSolid: true,
                isRuled: true,
                continuity: "c0",
            } satisfies LoftFeatureData,
        ]);
        expectBodyVolume(body, 40 * 30 * 20);
    });
});

describe("conformance: sweep", () => {
    test("a circle swept straight along a path is the cylinder over that path", () => {
        const doc = newDocument();
        // the path: a 5×5 column's vertical edge at the origin, from z = 0 to z = 20
        const columnSketch = addSketch(doc, rect(0, 0, 5, 5));
        const column = bodyWith({ doc, sketchNode: columnSketch }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: columnSketch.id,
                profiles: [captureProfileRef(profileOf(columnSketch))],
                depth: 20,
            } satisfies ExtrudeFeatureData,
        ]);
        const vertical = edgesOf(column).findIndex((edge) => round(edge.length()) === 20);
        const path = edgeRef(column, vertical);

        const profileSketch = addSketch(doc, circle(0, 0, 2));
        const body = bodyWith({ doc, sketchNode: profileSketch }, [
            {
                id: "w1",
                type: "sweep",
                sketchId: profileSketch.id,
                profiles: [captureProfileRef(profileOf(profileSketch))],
                path: { nodeId: column.id, edges: [path] },
            } satisfies SweepFeatureData,
        ]);
        expectBodyVolume(body, Math.PI * 2 ** 2 * 20);
    });
});
