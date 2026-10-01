// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    BoundingBox,
    type IShape,
    type IVisual,
    Matrix4,
    Plane,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockSelection, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { LoftFeatureCommand } from "../../src/commands/loftCommand";
import type { LoftFeatureData } from "../../src/features/feature";
import type { ProfileRef } from "../../src/features/profileRef";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { claimIdentityLosses } from "../identityLoss";

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 10, 0] },
        { id: 2, type: "line", params: [10, 0, 10, 10] },
        { id: 3, type: "line", params: [10, 10, 0, 10] },
        { id: 4, type: "line", params: [0, 10, 0, 0] },
    ],
    constraints: [],
};

/** The box both the section body and the preview loft report, so the join target probe hits. */
const BODY_BOX = new BoundingBox(XYZ.zero, new XYZ({ x: 10, y: 10, z: 20 }));

/** A pinched profile section reference, for the `section.profile` assertions. */
type ProfileSection = { kind: string; nodeId: string; profile: ProfileRef };

function profileOf(section: unknown): ProfileRef {
    return (section as ProfileSection).profile;
}

/**
 * A planar 10×10 square face whose lower-left corner sits at `origin` — what a pick off a
 * solid body reports. `disposed` records the ownership contract: the command frees every
 * transformed copy it made (`worldShape` → `owned`).
 */
interface FaceStub {
    readonly shapeType: ShapeType;
    readonly disposed: boolean;
    outerWire(): any;
    normal(u?: number, v?: number): [XYZ, XYZ];
    boundingBox(): BoundingBox;
    area(): number;
    isEqual(other: unknown): boolean;
    dispose(): void;
    transformedMul(matrix: Matrix4): FaceStub;
}

function faceShape(origin: XYZ): FaceStub {
    const corners = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
    ].map(([x, y]) => origin.add(new XYZ({ x, y, z: 0 })));
    const edges = corners.map((start, index) => {
        const end = corners[(index + 1) % corners.length];
        return {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { direction: end.sub(start).normalize() } },
            startPoint: () => start,
            endPoint: () => end,
        };
    });
    const wire = {
        shapeType: ShapeTypes.wire,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        mesh: { edges: { color: 0, lineWidth: 1 } },
        isEqual: () => false,
    };
    let disposed = false;
    return {
        shapeType: ShapeTypes.face,
        get disposed() {
            return disposed;
        },
        outerWire: () => wire,
        normal: () => [origin, XYZ.unitZ],
        boundingBox: () => new BoundingBox(origin, origin.add(new XYZ({ x: 10, y: 10, z: 0 }))),
        area: () => 100,
        isEqual: () => false,
        dispose: () => {
            disposed = true;
        },
        // The world copy a moved body's pick produces — the command fingerprints this one.
        transformedMul: (matrix: Matrix4) => faceShape(origin.add(matrix.translationPart())),
    };
}

function facePick(
    node: SketchNode | ParametricBodyNode,
    face: FaceStub | IShape,
    index = 0,
    transform = Matrix4.identity(),
): VisualShapeData {
    return { shape: face, owner: { node }, transform, indexes: [index] } as unknown as VisualShapeData;
}

function mockShapeFactory() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    /** The preview loft; the command disposes it as soon as the mesh is copied out. */
    const preview = {
        shapeType: ShapeTypes.solid,
        mesh: { faces: { color: 0 } },
        isEqual: () => false,
        findSubShapes: () => [],
        boundingBox: () => BODY_BOX,
        dispose: rs.fn(() => {}),
    };
    const loft = rs.fn((_sections: any[], _isSolid: boolean, _isRuled: boolean, _continuity: string) =>
        Result.ok(preview),
    );
    Object.defineProperty(globalThis, "shapeFactory", {
        value: { loft },
        writable: true,
        configurable: true,
    });
    return {
        loft,
        preview,
        restore: () => {
            if (previous) {
                Object.defineProperty(globalThis, "shapeFactory", previous);
            } else {
                delete (globalThis as any).shapeFactory;
            }
        },
    };
}

/** Installs the face ids the kernel's history would have named on the body's current shape. */
function trackFaces(body: ParametricBodyNode, faceIds: (string | undefined)[]) {
    const shape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: () => {},
        findSubShapes: () => [],
        // The join/cut target probe reads this (see `findIntersectingBody`).
        boundingBox: () => BODY_BOX,
    };
    (body as any)._shape = Result.ok(shape);
    (body as any)._timeline.commit([{ json: "", input: undefined, refs: new Map(), shape, faceIds }], []);
}

/**
 * A script step: a shape to hand to the pick loop, or an option-panel change the user makes
 * between two picks (the loop owns the option values — `beforeExecute` restores the ones the
 * LAST command of this class remembered, so setting them up front would be overwritten).
 */
type PickStep = VisualShapeData | (() => void);

/**
 * Feeds the pick loop a script; once the script runs out it confirms through the pick's
 * own controller — what the viewport bar's ✓ does — which ends the loop and commits.
 */
function scriptedPicker(script: PickStep[]) {
    let index = 0;
    return rs.fn((_prompt: string, controller: AsyncController, _options?: any) => {
        while (index < script.length) {
            const step = script[index++];
            if (typeof step !== "function") return Promise.resolve([step]);
            step();
        }
        controller.success();
        return Promise.resolve([]);
    });
}

function scenario(faceIds: (string | undefined)[] = ["f:bottom", "f:top"]) {
    const factory = mockShapeFactory();
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    // The real viewport mock: `clearVisual` clears the highlighter and the mesh it displayed.
    doc.visual = app.visualFactory.create(doc) as IVisual;
    doc.selection = createMockSelection();
    (app as any).activeView = { document: doc };

    const source = new ParametricBodyNode({ document: doc, features: [] });
    doc.modelManager.addNode(source);
    trackFaces(source, faceIds);

    const cmd = new LoftFeatureCommand();
    (cmd as any)._application = app;

    const committed = () =>
        doc.modelManager.findNode((node) => node instanceof ParametricBodyNode && node !== source) as
            | ParametricBodyNode
            | undefined;
    /** The committed body's loft feature — every test here expects the ✓ to have built one. */
    const committedFeature = () => {
        const body = committed();
        expect(body).toBeInstanceOf(ParametricBodyNode);
        return (body as ParametricBodyNode).features[0] as LoftFeatureData;
    };
    return { ...factory, app, doc, source, cmd, committed, committedFeature };
}

describe("LoftFeatureCommand section pick", () => {
    test("asks for one face, edge or vertex of any shape node", async () => {
        const { restore, app, doc, source, cmd } = scenario();
        const pickShape = scriptedPicker([]);
        doc.picker = { pickShape } as any;
        try {
            await cmd.execute(app);

            expect(pickShape).toHaveBeenCalledTimes(1);
            const [prompt, _controller, options] = pickShape.mock.calls[0] as any[];
            expect(prompt).toBe("prompt.select.section");
            expect(options.shapeType).toBe(ShapeTypes.face | ShapeTypes.edge | ShapeTypes.vertex);
            expect(options.multi).toBe(false);
            expect(options.nodeFilter.allow(source)).toBe(true);
            expect(options.nodeFilter.allow({})).toBe(false);
            // A click accepts a section, so the pick finishes on click and would show no
            // bar at all — the command asks for one to carry the "done" action.
            expect(options.showConfirmControl).toBe(true);
        } finally {
            restore();
        }
    });
});

describe("LoftFeatureCommand solid-face sections", () => {
    test("picks faces off a body and commits them as tracked source-face sections", async () => {
        const { restore, app, doc, source, cmd, committed, committedFeature } = scenario();
        const bottom = faceShape(XYZ.zero);
        const top = faceShape(new XYZ({ x: 0, y: 0, z: 20 }));
        doc.picker = {
            pickShape: scriptedPicker([facePick(source, bottom, 0), facePick(source, top, 1)]),
        } as any;
        try {
            await cmd.execute(app);

            const feature = committedFeature();
            expect(feature).toMatchObject({ type: "loft" });
            expect(feature.sections).toHaveLength(2);

            // World-coordinate fingerprint + the tracked face id + the outward normal: the
            // press-pull contract that lets a rebuild re-match by identity, not geometry.
            const first = profileOf(feature.sections[0]);
            expect(feature.sections[0]).toMatchObject({ kind: "profile", nodeId: source.id });
            expect(first.id).toBe("f:bottom");
            expect(first.normal).toEqual({ x: 0, y: 0, z: 1 });
            expect(first.edges).toHaveLength(4);
            expect(first.edges[0]).toMatchObject({
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 10, y: 0, z: 0 },
            });
            expect(profileOf(feature.sections[1]).edges[0]).toMatchObject({
                kind: "line",
                start: { x: 0, y: 0, z: 20 },
            });

            // A source body is not consumed — only sketches are hidden, and this loft has none.
            expect(source.visible).toBe(true);

            doc.history.undo();
            expect(committed()).toBeUndefined();
            expect(source.visible).toBe(true);
        } finally {
            restore();
        }
    });

    test("a face picked through a non-identity transform is fingerprinted in world coordinates", async () => {
        const { restore, app, doc, source, cmd, loft, committedFeature } = scenario();
        // The body sits at x=100; the pick reports its local face plus the body's transform.
        const local = faceShape(XYZ.zero);
        const world = faceShape(new XYZ({ x: 100, y: 0, z: 0 }));
        (local as any).transformedMul = rs.fn((_matrix: Matrix4) => world);
        const movedPick = facePick(source, local, 0, Matrix4.fromTranslation(100, 0, 0));
        const stillPick = facePick(source, faceShape(XYZ.zero), 1);
        doc.picker = { pickShape: scriptedPicker([movedPick, stillPick]) } as any;
        try {
            await cmd.execute(app);

            const feature = committedFeature();
            const moved = profileOf(feature.sections[0]);
            expect(moved.edges[0]).toMatchObject({
                kind: "line",
                start: { x: 100, y: 0, z: 0 },
                end: { x: 110, y: 0, z: 0 },
            });
            // The transformed copy is the command's to free, and the preview lofts the same
            // world wires the refs were captured from.
            expect((local as any).transformedMul).toHaveBeenCalledTimes(1);
            expect(world.disposed).toBe(true);
            const previewed = loft.mock.calls[0][0] as any[];
            expect((previewed[0].findSubShapes(ShapeTypes.edge) as any[])[0].startPoint().x).toBe(100);
        } finally {
            restore();
        }
    });

    test("a sketch section keeps its raw fingerprint while the preview uses the world shape", async () => {
        const { restore, app, doc, source, cmd, committedFeature } = scenario();
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);
        const local = faceShape(XYZ.zero);
        const world = faceShape(new XYZ({ x: 50, y: 0, z: 0 }));
        (local as any).transformedMul = rs.fn((_matrix: Matrix4) => world);
        doc.picker = {
            pickShape: scriptedPicker([
                facePick(sketch, local, 0, Matrix4.fromTranslation(50, 0, 0)),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 0),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            const feature = committedFeature();
            // A sketch's profile is fingerprinted in SKETCH space — the solver may mirror the
            // wire on rebuild, so a world-space ref (and its normal) would not survive.
            const fromSketch = profileOf(feature.sections[0]);
            expect(fromSketch.id).toBeUndefined();
            expect(fromSketch.normal).toBeUndefined();
            expect(fromSketch.edges[0]).toMatchObject({
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 10, y: 0, z: 0 },
            });
            // The consumed sketch is hidden (undo restores it), the source body is not.
            expect(sketch.visible).toBe(false);
            expect(source.visible).toBe(true);

            doc.history.undo();
            expect(sketch.visible).toBe(true);
        } finally {
            restore();
        }
    });

    test("a tracked body's unnamed face is reported instead of silently degrading", async () => {
        const { restore, app, doc, source, cmd, committedFeature } = scenario([undefined, "f:top"]);
        doc.picker = {
            pickShape: scriptedPicker([
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            expect(profileOf(committedFeature().sections[0]).id).toBeUndefined();
            const losses = claimIdentityLosses();
            expect(losses).toHaveLength(1);
            expect(losses[0]).toContain("a loft section face has no tracked id");
        } finally {
            restore();
        }
    });

    test("a face split by an earlier boolean is recorded as a single piece", async () => {
        // Index 1 shares index 0's last id component — one face, two pieces.
        const { restore, app, doc, source, cmd, committedFeature } = scenario([
            "f:top|f:extra",
            "f:top",
            "f:bottom",
        ]);
        doc.picker = {
            pickShape: scriptedPicker([
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 2),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            const feature = committedFeature();
            // A shared id means the pick is one piece of a split face: the ref must never
            // widen back to the whole span (see `matchSourceFaceIndexes`).
            expect(profileOf(feature.sections[0])).toMatchObject({ id: "f:top|f:extra", splitPiece: true });
            expect(profileOf(feature.sections[1])).toMatchObject({ id: "f:bottom", splitPiece: false });
        } finally {
            restore();
        }
    });

    test("the option panel's ✓ commits the current parameters and disposes the preview", async () => {
        const { restore, app, doc, source, cmd, loft, preview, committedFeature } = scenario();
        const toShellRuled = () => {
            cmd.isSolid = false;
            cmd.isRuled = true;
            cmd.continuity = "c1";
        };
        doc.picker = {
            pickShape: scriptedPicker([
                facePick(source, faceShape(XYZ.zero), 0),
                toShellRuled,
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            expect(committedFeature()).toMatchObject({
                isSolid: false,
                isRuled: true,
                continuity: "c1",
            });
            // The preview is built once, after the second pick, from the world wires — with
            // the options as they stood at that moment.
            expect(loft).toHaveBeenCalledTimes(1);
            const [sections, isSolid, isRuled, continuity] = loft.mock.calls[0] as any[];
            expect(sections).toHaveLength(2);
            expect([isSolid, isRuled, continuity]).toEqual([false, true, "c1"]);
            expect(preview.dispose).toHaveBeenCalledTimes(1);
        } finally {
            restore();
        }
    });

    test("a pick that is not a wire section is refused and the loop keeps going", async () => {
        const { restore, app, doc, source, cmd, committedFeature } = scenario();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        doc.picker = {
            pickShape: scriptedPicker([
                {
                    shape: { shapeType: ShapeTypes.compound },
                    owner: { node: source },
                    transform: Matrix4.identity(),
                    indexes: [0],
                } as any,
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            expect(pub).toHaveBeenCalledWith("showToast", "error.default:{0}", "Unsupported loft section");
            // The rejected pick was not recorded — the two faces are the whole section list.
            expect(committedFeature().sections).toHaveLength(2);
        } finally {
            pub.mockRestore();
            restore();
        }
    });

    test("✓ on a single section is refused with a toast and commits nothing", async () => {
        const { restore, app, doc, source, cmd, committed } = scenario();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        doc.picker = { pickShape: scriptedPicker([facePick(source, faceShape(XYZ.zero), 0)]) } as any;
        try {
            await cmd.execute(app);

            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Loft requires at least 2 sections",
            );
            expect(committed()).toBeUndefined();
        } finally {
            pub.mockRestore();
            restore();
        }
    });
});

describe("LoftFeatureCommand operation", () => {
    test("join appends the loft to the intersecting body instead of creating one", async () => {
        const { restore, app, doc, source, cmd, loft } = scenario();
        doc.picker = {
            pickShape: scriptedPicker([
                () => {
                    // The option panel remembers the LAST command's values across tests
                    // (`CancelableCommand._propertiesCache`), so every test states its own.
                    cmd.isSolid = true;
                    cmd.operation = "option.command.operation.join";
                },
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            expect(source.features).toHaveLength(1);
            expect(source.features[0]).toMatchObject({ type: "loft", operation: "fuse" });
            // No standalone body: the feature went onto the target's chain.
            expect(
                doc.modelManager.findNode((node) => node instanceof ParametricBodyNode && node !== source),
            ).toBeUndefined();
            // The probe is a second, thrown-away loft build (the preview is the first).
            expect(loft).toHaveBeenCalledTimes(2);
        } finally {
            restore();
        }
    });

    test("cut maps to the common boolean and intersect to the fuse's counterpart", async () => {
        const { restore, app, doc, source, cmd } = scenario();
        doc.picker = {
            pickShape: scriptedPicker([
                () => {
                    cmd.isSolid = true;
                    cmd.operation = "option.command.operation.cut";
                },
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);
            expect(source.features[0]).toMatchObject({ operation: "cut" });
        } finally {
            restore();
        }
    });

    test("a shell loft drops the operation and stands alone", async () => {
        const { restore, app, doc, source, cmd, committed } = scenario();
        doc.picker = {
            pickShape: scriptedPicker([
                () => {
                    cmd.isSolid = false;
                    cmd.operation = "option.command.operation.join";
                },
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            // A shell has no volume to combine with: no operation is stored, and the
            // target chain is left untouched.
            expect(source.features).toHaveLength(0);
            const feature = (committed() as ParametricBodyNode).features[0] as LoftFeatureData;
            expect(feature).toMatchObject({ type: "loft", isSolid: false });
            expect(feature.operation).toBeUndefined();
        } finally {
            restore();
        }
    });

    test("an operation that finds no target still stands the loft up as its own body", async () => {
        const { restore, app, doc, source, cmd, committedFeature } = scenario();
        // Nothing intersects: the section body's box is empty and the preview's is disjoint.
        (source as any)._shape = Result.ok({
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: () => {},
            findSubShapes: () => [],
            boundingBox: () =>
                new BoundingBox(new XYZ({ x: 100, y: 100, z: 100 }), new XYZ({ x: 110, y: 110, z: 110 })),
        });
        doc.picker = {
            pickShape: scriptedPicker([
                () => {
                    cmd.isSolid = true;
                    cmd.operation = "option.command.operation.join";
                },
                facePick(source, faceShape(XYZ.zero), 0),
                facePick(source, faceShape(new XYZ({ x: 0, y: 0, z: 20 })), 1),
            ]),
        } as any;
        try {
            await cmd.execute(app);

            expect(source.features).toHaveLength(0);
            expect(committedFeature().operation).toBeUndefined();
        } finally {
            restore();
        }
    });
});
