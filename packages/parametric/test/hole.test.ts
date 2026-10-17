// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IFace,
    type IShape,
    Matrix4,
    Plane,
    Result,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/features"; // registers all feature handlers
import {
    type FeatureContext,
    featureHandler,
    type HoleFeatureData,
    type ShapeTracking,
} from "../src/features/feature";
import {
    findSketchPointAt,
    holeCenter,
    holePointUV,
    resolveHoleCenters,
    resolveHolePlane,
} from "../src/features/hole";
import { presetTokens } from "../src/features/holeStandards";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchEntityData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";

describe("hole feature", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    const holeFeature = (overrides?: Partial<HoleFeatureData>): HoleFeatureData => ({
        id: "h1",
        type: "hole",
        face: { nodeId: "n1", normal: { x: 0, y: 0, z: 1 }, offset: 20 },
        points: [[5, 5]],
        style: "simple",
        diameter: 5,
        ...overrides,
    });

    const handler = () => featureHandler("hole")!;

    /** A context whose input exists, for the guards that run before any kernel call. */
    const evaluate = (feature: HoleFeatureData) =>
        handler().evaluate(feature, {
            document: doc,
            host: { id: "host", worldTransform: () => Matrix4.identity() },
            input: {} as IShape,
            scope: doc.variables.evaluate().scope,
        } as FeatureContext);

    test("is registered with its ribbon identity and reselect", () => {
        expect(handler().display).toBe("command.feature.hole");
        expect(handler().icon).toBe("icon-hole");
        expect(handler().reselectable).toBe(true);
    });

    test("references name the picked face's node", () => {
        const feature = holeFeature();
        expect(handler().nodeIds(feature)).toEqual(["n1"]);
        expect(handler().references?.(feature)).toEqual([
            { key: "face", display: "feature.hole.face", nodeId: "n1" },
        ]);
    });

    describe("parameters", () => {
        test("the style row offers the three styles", () => {
            const style = handler()
                .parameters(holeFeature())
                .find((x) => x.key === "style");
            expect(style).toEqual({
                key: "style",
                display: "common.type",
                value: "simple",
                choices: [
                    { value: "simple", display: "feature.hole.style.simple" },
                    { value: "counterbore", display: "feature.hole.style.counterbore" },
                    { value: "countersink", display: "feature.hole.style.countersink" },
                ],
            });
        });

        test("the preset row is blank and lists the style's presets", () => {
            const preset = handler()
                .parameters(holeFeature())
                .find((x) => x.key === "preset");
            expect(preset?.value).toBe("");
            // 10 sizes × 3 clearance classes; the tokens carry no i18n label.
            expect(preset?.choices).toHaveLength(30);
            expect(preset?.choices?.every((x) => x.display === undefined)).toBe(true);
        });

        test("an absent depth shows as a blank field (through all)", () => {
            const depth = handler()
                .parameters(holeFeature())
                .find((x) => x.key === "depth");
            expect(depth?.value).toBe("");
            expect(
                handler()
                    .parameters(holeFeature({ depth: 12 }))
                    .find((x) => x.key === "depth")?.value,
            ).toBe(12);
        });

        test("the drill angle defaults to 118°", () => {
            const row = handler()
                .parameters(holeFeature())
                .find((x) => x.key === "drillAngle");
            expect(row?.value).toBe(118);
            expect(
                handler()
                    .parameters(holeFeature({ drillAngle: 135 }))
                    .find((x) => x.key === "drillAngle")?.value,
            ).toBe(135);
        });

        test("the recess rows are gated to their style and default when unset", () => {
            const rows = handler().parameters(holeFeature({ style: "counterbore" }));
            const cd = rows.find((x) => x.key === "counterbore.diameter");
            expect(cd?.visibleWhen).toEqual([{ key: "style", value: "counterbore" }]);
            expect(cd?.value).toBe(10);
            expect(rows.find((x) => x.key === "counterbore.depth")?.value).toBe(3);

            const csk = handler()
                .parameters(holeFeature({ style: "countersink" }))
                .find((x) => x.key === "countersink.angle");
            expect(csk?.visibleWhen).toEqual([{ key: "style", value: "countersink" }]);
            expect(csk?.value).toBe(90);
        });

        test("set recess values are read back", () => {
            const feature = holeFeature({
                style: "counterbore",
                counterbore: { diameter: 14, depth: 8 },
            });
            const rows = handler().parameters(feature);
            expect(rows.find((x) => x.key === "counterbore.diameter")?.value).toBe(14);
            expect(rows.find((x) => x.key === "counterbore.depth")?.value).toBe(8);
        });
    });

    describe("setParameter", () => {
        const set = (feature: HoleFeatureData, key: string, value: number | string | boolean) =>
            handler().setParameter(feature, key, value);

        test("style switches; an unknown token keeps the feature", () => {
            expect(set(holeFeature(), "style", "counterbore").style).toBe("counterbore");
            expect(set(holeFeature(), "style", "bogus")).toEqual(holeFeature());
        });

        test("a simple preset writes its clearance diameter, nothing else", () => {
            const result = set(holeFeature({ drillAngle: 90 }), "preset", "M8 · normal · ⌀9");
            expect(result.diameter).toBe(9);
            expect(result.drillAngle).toBe(90);
            expect(result.style).toBe("simple");
        });

        test("the clearance class is read from the token", () => {
            expect(set(holeFeature(), "preset", "M8 · close · ⌀8.4").diameter).toBe(8.4);
            expect(set(holeFeature(), "preset", "M8 · loose · ⌀10").diameter).toBe(10);
        });

        test("a counterbore preset fills the diameter and the recess", () => {
            const result = set(holeFeature({ style: "counterbore" }), "preset", "M8 · ⌀9 / ⌀14×8");
            expect(result.diameter).toBe(9);
            expect(result.counterbore).toEqual({ diameter: 14, depth: 8 });
        });

        test("a countersink preset fills the diameter and the cone", () => {
            const result = set(holeFeature({ style: "countersink" }), "preset", "M8 · ⌀9 / ⌀17.92×90°");
            expect(result.diameter).toBe(9);
            expect(result.countersink).toEqual({ diameter: 17.92, angle: 90 });
        });

        test("an unknown preset token changes nothing", () => {
            expect(set(holeFeature(), "preset", "ACME 1/4-20")).toEqual(holeFeature());
        });

        test("a blank depth strips the key (through all); a value sets it", () => {
            const blind = set(holeFeature(), "depth", 12);
            expect(blind.depth).toBe(12);
            const through = set(blind, "depth", "");
            expect("depth" in through).toBe(false);
        });

        test("a recess field creates its object with the sibling default", () => {
            const result = set(holeFeature({ style: "counterbore" }), "counterbore.diameter", 14);
            expect(result.counterbore).toEqual({ diameter: 14, depth: 3 });
            const cone = set(holeFeature({ style: "countersink" }), "countersink.angle", 82);
            expect(cone.countersink).toEqual({ diameter: 10, angle: 82 });
        });

        test("a boolean value or an unknown key changes nothing", () => {
            const feature = holeFeature();
            expect(set(feature, "diameter", true)).toEqual(feature);
            expect(set(feature, "depth", true)).toEqual(feature);
            expect(set(feature, "counterbore.diameter", false)).toEqual(feature);
            expect(set(feature, "nonsense", 3)).toEqual(feature);
        });
    });

    describe("evaluate guards", () => {
        test("an invalid style is rejected before anything else runs", () => {
            const body = new ParametricBodyNode({
                document: doc,
                features: [holeFeature({ style: "bogus" as HoleFeatureData["style"] })],
            });
            doc.modelManager.addNode(body);
            // Reading the shape is what runs the rebuild; the row then carries the error.
            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Invalid hole style: bogus");
        });

        test("a hole needs a preceding feature", () => {
            const body = new ParametricBodyNode({ document: doc, features: [holeFeature()] });
            doc.modelManager.addNode(body);
            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Hole requires a preceding feature");
        });

        test("a hole needs at least one point", () => {
            const result = evaluate(holeFeature({ points: [] }));
            expect(result.isOk).toBe(false);
            expect((result as { error: string }).error).toBe("Hole requires at least one point");
        });

        test("a non-positive or unresolvable diameter is rejected", () => {
            const zero = evaluate(holeFeature({ diameter: 0 }));
            expect((zero as { error: string }).error).toBe("Hole diameter must be positive");
            const bad = evaluate(holeFeature({ diameter: "not a number" }));
            expect(bad.isOk).toBe(false);
        });

        test("the drill angle must lie between 0 and 180", () => {
            const flat = evaluate(holeFeature({ drillAngle: 180 }));
            expect((flat as { error: string }).error).toBe(
                "Hole drill angle must be between 0 and 180 degrees",
            );
        });

        test("a blind depth must exceed the drill tip height", () => {
            // r = 2.5 at 118°: tip = 2.5/tan(59°) ≈ 1.5.
            const result = evaluate(holeFeature({ depth: 1 }));
            expect((result as { error: string }).error).toBe("Hole depth must exceed the drill tip height");
        });

        test("a counterbore style without recess dimensions is rejected", () => {
            const result = evaluate(holeFeature({ style: "counterbore" }));
            expect((result as { error: string }).error).toBe(
                "Counterbore hole requires its counterbore dimensions",
            );
        });

        test("a counterbore not wider than the hole is rejected", () => {
            const result = evaluate(
                holeFeature({ style: "counterbore", counterbore: { diameter: 5, depth: 2 } }),
            );
            expect((result as { error: string }).error).toBe(
                "Counterbore diameter must exceed the hole diameter",
            );
        });

        test("a countersink style without recess dimensions is rejected", () => {
            const result = evaluate(holeFeature({ style: "countersink" }));
            expect((result as { error: string }).error).toBe(
                "Countersink hole requires its countersink dimensions",
            );
        });

        test("a countersink angle outside (0, 180) is rejected", () => {
            const result = evaluate(
                holeFeature({ style: "countersink", countersink: { diameter: 10, angle: 0 } }),
            );
            expect((result as { error: string }).error).toBe(
                "Countersink angle must be between 0 and 180 degrees",
            );
        });

        test("a face on a node that no longer exists fails the rebuild", () => {
            const result = evaluate(holeFeature());
            expect((result as { error: string }).error).toBe("Hole plane body not found");
        });
    });

    describe("the (u, v) placement contract", () => {
        test("holeCenter and holePointUV are each other's inverse, projection included", () => {
            const plane = new Plane({ origin: new XYZ(1, 2, 3), normal: XYZ.unitZ, xvec: XYZ.unitX });
            const center = holeCenter(plane, [4, -7]);
            expect(center.distanceTo(new XYZ(5, -5, 3))).toBeLessThan(1e-9);
            const uv = holePointUV(plane, center);
            expect(uv[0]).toBeCloseTo(4);
            expect(uv[1]).toBeCloseTo(-7);
            // A point OFF the plane projects into it before the coordinates are read.
            const off = holePointUV(plane, new XYZ(5, -5, 99));
            expect(off[0]).toBeCloseTo(4);
            expect(off[1]).toBeCloseTo(-7);
        });

        test("the frame follows the plane: the same uv lands where the plane moved", () => {
            const tilted = new Plane({ origin: XYZ.zero, normal: XYZ.unitY, xvec: XYZ.unitZ });
            const center = holeCenter(tilted, [3, 4]);
            // The frame's own axes decide the direction; the uv always reads back.
            const uv = holePointUV(tilted, center);
            expect(uv[0]).toBeCloseTo(3);
            expect(uv[1]).toBeCloseTo(4);
            expect(center.y).toBeCloseTo(0);
        });
    });

    /** A sketch of the given entities, in the document — no kernel needed until a shape is read. */
    const pointSketch = (entities: SketchEntityData[], plane: Plane = Plane.XY) => {
        const node = new SketchNode({ document: doc, plane, data: { entities, constraints: [] } });
        doc.modelManager.addNode(node);
        return node;
    };

    describe("sketch-point bindings on the handler", () => {
        test("nodeIds and references name the bound sketch beside the face", () => {
            const feature = holeFeature({ sketchPoints: { sketchId: "s1", entityIds: [7, 9] } });
            expect(handler().nodeIds(feature)).toEqual(["n1", "s1"]);
            expect(handler().references?.(feature)).toEqual([
                { key: "face", display: "feature.hole.face", nodeId: "n1" },
                { key: "sketchPoints", display: "body.sketch", nodeId: "s1" },
            ]);
        });

        test("a feature with neither raw points nor bound ones is rejected", () => {
            const result = evaluate(
                holeFeature({ points: [], sketchPoints: { sketchId: "s1", entityIds: [] } }),
            );
            expect((result as { error: string }).error).toBe("Hole requires at least one point");
        });

        test("with every center lost the holes suspend and the input passes through", () => {
            const tracking: ShapeTracking = {
                inputFaceIds: ["f10", "f11"],
                outputFaceIds: [],
                inputEdgeIds: ["e20"],
                outputEdgeIds: [],
            };
            const input = { findSubShapes: () => [] } as unknown as IShape;
            const result = handler().evaluate(
                holeFeature({
                    // The host's own node id, so the plane falls back to the frozen fingerprint
                    // against the face-less mock input — and claims the unresolved slot first.
                    face: { nodeId: "host", normal: { x: 0, y: 0, z: 1 }, offset: 20 },
                    points: [],
                    sketchPoints: { sketchId: "missing", entityIds: [3] },
                }),
                {
                    document: doc,
                    host: { id: "host", worldTransform: () => Matrix4.identity() },
                    input,
                    scope: doc.variables.evaluate().scope,
                    tracking,
                },
            );
            expect(result.isOk).toBe(true);
            expect(result.unchecked()).toBe(input);
            expect(tracking.unresolved).toEqual({ key: "face", refIndexes: [0] });
            // A pass-through keeps the input's ids — downstream features still resolve refs.
            expect(tracking.outputFaceIds).toEqual(["f10", "f11"]);
            expect(tracking.outputEdgeIds).toEqual(["e20"]);
        });
    });

    describe("resolveHoleCenters", () => {
        const context = (transform = Matrix4.identity()) =>
            ({
                document: doc,
                host: { id: "host", worldTransform: () => transform },
                scope: doc.variables.evaluate().scope,
            }) as FeatureContext;

        test("raw picks keep their slots; bound points follow with the next ones", () => {
            const sketch = pointSketch([
                { id: 1, type: "point", params: [3, 4] },
                { id: 2, type: "point", params: [30, 40] },
            ]);
            const feature = holeFeature({
                points: [[1, 1]],
                sketchPoints: { sketchId: sketch.id, entityIds: [1, 2] },
            });
            const { centers, lost } = resolveHoleCenters(feature, Plane.XY, context());
            expect(lost).toEqual([]);
            expect(centers).toEqual([
                { uv: [1, 1], slot: 0 },
                { uv: [3, 4], slot: 1 },
                { uv: [30, 40], slot: 2 },
            ]);
        });

        test("a lost sketch reports every bound index", () => {
            const feature = holeFeature({
                points: [[1, 1]],
                sketchPoints: { sketchId: "missing", entityIds: [1, 2] },
            });
            const { centers, lost } = resolveHoleCenters(feature, Plane.XY, context());
            expect(lost).toEqual([0, 1]);
            expect(centers).toEqual([{ uv: [1, 1], slot: 0 }]);
        });

        test("a deleted or retyped entity loses only its own slot", () => {
            const sketch = pointSketch([
                { id: 1, type: "point", params: [3, 4] },
                { id: 2, type: "line", params: [0, 0, 9, 0] },
            ]);
            const feature = holeFeature({
                points: [],
                sketchPoints: { sketchId: sketch.id, entityIds: [9, 1, 2] },
            });
            const { centers, lost } = resolveHoleCenters(feature, Plane.XY, context());
            expect(lost).toEqual([0, 2]);
            // The survivor keeps slot 1 — the lost indexes are not compacted away.
            expect(centers).toEqual([{ uv: [3, 4], slot: 1 }]);
        });

        test("a sketch off the hole face still resolves — the point projects along the normal", () => {
            const above = new Plane({ origin: new XYZ(0, 0, 30), normal: XYZ.unitZ, xvec: XYZ.unitX });
            const sketch = pointSketch([{ id: 1, type: "point", params: [3, 4] }], above);
            const feature = holeFeature({
                points: [],
                sketchPoints: { sketchId: sketch.id, entityIds: [1] },
            });
            const { centers, lost } = resolveHoleCenters(feature, Plane.XY, context());
            expect(lost).toEqual([]);
            expect(centers).toEqual([{ uv: [3, 4], slot: 0 }]);
        });

        test("the host's own transform is backed out of the resolved center", () => {
            const sketch = pointSketch([{ id: 1, type: "point", params: [3, 4] }]);
            const feature = holeFeature({
                points: [],
                sketchPoints: { sketchId: sketch.id, entityIds: [1] },
            });
            const { centers, lost } = resolveHoleCenters(
                feature,
                Plane.XY,
                context(Matrix4.fromTranslation(100, 0, 0)),
            );
            expect(lost).toEqual([]);
            expect(centers).toEqual([{ uv: [-97, 4], slot: 0 }]);
        });
    });

    describe("findSketchPointAt", () => {
        test("snaps to the point within tolerance, its center projected onto the frame", () => {
            const sketch = pointSketch([
                { id: 1, type: "point", params: [3, 4] },
                { id: 2, type: "point", params: [30, 40] },
            ]);
            const hit = findSketchPointAt(doc, Plane.XY, new XYZ(3.4, 4.2, 0), 1);
            expect(hit?.sketchId).toBe(sketch.id);
            expect(hit?.entityId).toBe(1);
            expect(hit!.center.distanceTo(new XYZ(3, 4, 0))).toBeLessThan(1e-9);
        });

        test("the nearer of two in-reach points wins", () => {
            pointSketch([
                { id: 1, type: "point", params: [3, 4] },
                { id: 2, type: "point", params: [4.6, 4] },
            ]);
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(4.2, 4, 0), 1.5)?.entityId).toBe(2);
        });

        test("beyond the tolerance there is no snap", () => {
            pointSketch([{ id: 1, type: "point", params: [3, 4] }]);
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(30, 4, 0), 1)).toBeUndefined();
        });

        test("a sketch point off the frame projects onto it for the snap", () => {
            const above = new Plane({ origin: new XYZ(0, 0, 30), normal: XYZ.unitZ, xvec: XYZ.unitX });
            pointSketch([{ id: 1, type: "point", params: [3, 4] }], above);
            const hit = findSketchPointAt(doc, Plane.XY, new XYZ(3.2, 3.9, 0), 1);
            expect(hit?.entityId).toBe(1);
            expect(hit!.center.z).toBeCloseTo(0, 9);
        });

        test("the pinned sketch alone snaps — another sketch's point is passed over", () => {
            const a = pointSketch([{ id: 1, type: "point", params: [3, 4] }]);
            const b = pointSketch([{ id: 2, type: "point", params: [30, 40] }]);
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(30.2, 40, 0), 1, a.id)).toBeUndefined();
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(30.2, 40, 0), 1, b.id)?.entityId).toBe(2);
        });

        test("construction points, hidden sketches and non-point entities never snap", () => {
            const sketch = pointSketch([
                { id: 1, type: "point", params: [3, 4], construction: true },
                { id: 2, type: "line", params: [10, 10, 20, 10] },
            ]);
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(3, 4, 0), 1)).toBeUndefined();
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(10, 10, 0), 1)).toBeUndefined();
            sketch.visible = false;
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(10, 10, 0), 1)).toBeUndefined();
            const hidden = pointSketch([{ id: 3, type: "point", params: [50, 50] }]);
            hidden.visible = false;
            expect(findSketchPointAt(doc, Plane.XY, new XYZ(50, 50, 0), 1)).toBeUndefined();
        });
    });

    describe("the preset table drives the panel", () => {
        test("every simple token the row offers parses back", () => {
            for (const token of presetTokens("simple")) {
                expect(token).toMatch(/^M\d+ · (close|normal|loose) · ⌀/);
            }
        });

        test("the countersink row skips M14 (no tabulated head)", () => {
            expect(presetTokens("countersink").some((x) => x.startsWith("M14"))).toBe(false);
            expect(presetTokens("counterbore").some((x) => x.startsWith("M14"))).toBe(true);
        });
    });

    describe("resolveHolePlane", () => {
        function planarFace(point: XYZ, normal: XYZ): IFace {
            return {
                shapeType: ShapeTypes.face,
                normal: () => [point, normal],
                surface: () => ({ isPlanar: () => true }),
                transformed: (m: Matrix4) => planarFace(m.ofPoint(point), m.ofVector(normal)),
                transformedMul: (m: Matrix4) => planarFace(m.ofPoint(point), m.ofVector(normal)),
                isEqual: () => false,
                dispose: rs.fn(),
            } as unknown as IFace;
        }

        function solidWith(...faces: IFace[]): IShape {
            return {
                shapeType: ShapeTypes.solid,
                findSubShapes: (type: number) => (type === ShapeTypes.face ? faces : []),
                isEqual: () => false,
                dispose: rs.fn(),
            } as unknown as IShape;
        }

        const contextFor = (hostTransform: Matrix4, input?: IShape) =>
            ({
                document: doc,
                host: { id: "host", worldTransform: () => hostTransform },
                input,
                scope: doc.variables.evaluate().scope,
            }) as FeatureContext;

        test("a rolled-back foreign source is refused — its shape is the session preview", () => {
            const source = new EditableShapeNode({
                document: doc,
                name: "src",
                shape: Result.ok(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 0 }), XYZ.unitZ))),
            });
            doc.modelManager.addNode(source);
            // Structurally a timeline body (faceIdAt + timelineStateAt) parked on a rollback.
            Object.defineProperty(source, "faceIdAt", { value: () => undefined });
            Object.defineProperty(source, "timelineStateAt", { value: () => undefined });
            Object.defineProperty(source, "rollbackIndex", { value: 1 });

            const resolved = resolveHolePlane(
                { nodeId: source.id, normal: { x: 0, y: 0, z: 1 }, offset: 0 },
                contextFor(Matrix4.identity()),
            );

            expect(resolved.isOk).toBe(false);
            expect((resolved as { error: string }).error).toBe("Hole plane body is rolled back");
        });

        test("a foreign source's face thunk hands out host-local copies, one per call", () => {
            const face = planarFace(new XYZ({ x: 1, y: 2, z: 5 }), XYZ.unitZ);
            const source = new EditableShapeNode({
                document: doc,
                name: "src",
                shape: Result.ok(solidWith(face)),
            });
            doc.modelManager.addNode(source);
            // The host is translated, so host-local ≠ source-local: a face handed out
            // unmapped would still show the source's coordinates.
            const resolved = resolveHolePlane(
                { nodeId: source.id, normal: { x: 0, y: 0, z: 1 }, offset: 5 },
                contextFor(Matrix4.fromTranslation(100, 0, 0)),
            );

            expect(resolved.isOk).toBe(true);
            const value = resolved.value;
            expect(value.face).toBeDefined();
            const copy1 = value.face!();
            const copy2 = value.face!();
            try {
                expect(copy1).not.toBe(face);
                expect(copy1).not.toBe(copy2);
                const [point, normal] = copy1.normal(0, 0);
                expect(point.isEqualTo(new XYZ({ x: -99, y: 2, z: 5 }))).toBe(true);
                expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
                // The plane was already mapped by resolveHolePlane itself.
                expect(value.plane.origin.isEqualTo(new XYZ({ x: -100, y: 0, z: 5 }))).toBe(true);
            } finally {
                copy1.dispose();
                copy2.dispose();
            }
        });

        test("the host's own face comes back in host coordinates", () => {
            const face = planarFace(new XYZ({ x: 3, y: 4, z: 10 }), XYZ.unitZ);
            // Host at z +50: the world capture's offset is 60, the map back is identity.
            const resolved = resolveHolePlane(
                { nodeId: "host", normal: { x: 0, y: 0, z: 1 }, offset: 60 },
                contextFor(Matrix4.fromTranslation(0, 0, 50), solidWith(face)),
            );

            expect(resolved.isOk).toBe(true);
            const value = resolved.value;
            const copy = value.face!();
            try {
                expect(copy).not.toBe(face);
                const [point, normal] = copy.normal(0, 0);
                expect(point.isEqualTo(new XYZ({ x: 3, y: 4, z: 10 }))).toBe(true);
                expect(normal.isEqualTo(XYZ.unitZ)).toBe(true);
                expect(value.plane.origin.isEqualTo(new XYZ({ x: 0, y: 0, z: 10 }))).toBe(true);
            } finally {
                copy.dispose();
            }
        });

        test("the frozen fallback carries no face thunk", () => {
            // Nothing matches the captured +Z normal — the fingerprint takes over.
            const input = solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 1 }), XYZ.unitX));
            const resolved = resolveHolePlane(
                { nodeId: "host", normal: { x: 0, y: 0, z: 1 }, offset: 10 },
                contextFor(Matrix4.identity(), input),
            );

            expect(resolved.isOk).toBe(true);
            expect(resolved.value.face).toBeUndefined();
            expect(resolved.value.lost).toEqual({ key: "face", refIndexes: [0] });
        });
    });
});
