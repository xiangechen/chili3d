// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import type { BooleanFeatureData, ExtrudeFeatureData, FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../../src/sketch";
import { computeSketchRollback } from "../../src/sketch/sketchRollback";

const SKETCH_ID = "sk";

let featureSeq = 0;

function extrude(sketchId: string): ExtrudeFeatureData {
    return { id: `ex-${sketchId}-${featureSeq++}`, type: "extrude", sketchId, depth: 10 };
}

function fuse(id: string, toolIds: string[]): BooleanFeatureData {
    return { id, type: "boolean", operation: "fuse", toolIds };
}

function setup(data?: SketchData) {
    const doc = new TestDocument({ application: createMockApplication() });
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        id: SKETCH_ID,
        data: data ?? { entities: [], constraints: [] },
    });
    doc.modelManager.addNode(sketch);
    return { doc, sketch };
}

function addBody(doc: TestDocument, features: FeatureData[], id?: string): ParametricBodyNode {
    const body = new ParametricBodyNode({ document: doc, features, id });
    doc.modelManager.addNode(body);
    return body;
}

test("a body rolls back to its first feature referencing the sketch", () => {
    const { doc, sketch } = setup();
    const body = addBody(doc, [extrude("other-sketch"), extrude(SKETCH_ID), extrude(SKETCH_ID)]);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.get(body)).toBe(1);
});

test("an unrelated body is left alone", () => {
    const { doc, sketch } = setup();
    const body = addBody(doc, [extrude("other-sketch")]);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.has(body)).toBe(false);
});

test("a boolean tool carries the dependency across bodies, transitively", () => {
    const { doc, sketch } = setup();
    const consumer = addBody(doc, [extrude(SKETCH_ID)]);
    const joiner = addBody(doc, [extrude("other-sketch"), fuse("b1", [consumer.id])]);
    const cutter = addBody(doc, [fuse("b2", [joiner.id])]);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.get(consumer)).toBe(0);
    // the boolean sits at index 1 — the feature before it stays evaluated
    expect(rollback.get(joiner)).toBe(1);
    expect(rollback.get(cutter)).toBe(0);
});

test("a tool referenced before the sketch-consuming feature pulls the index down", () => {
    const { doc, sketch } = setup();
    const tool = addBody(doc, [extrude(SKETCH_ID)]);
    // the tool is consumed at index 0, the sketch only at index 2 — the earlier
    // dependency wins even though the tool is discovered after this body
    const body = addBody(doc, [fuse("b1", [tool.id]), extrude("other-sketch"), extrude(SKETCH_ID)]);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.get(body)).toBe(0);
});

test("a self-sourced feature does not make the body downstream", () => {
    const { doc, sketch } = setup();
    // press-pull on the body's own face: the self-reference carries no dependency
    const body = addBody(
        doc,
        [
            { id: "pp", type: "extrude", depth: 5, source: { nodeId: "self-body", profiles: [] } },
            extrude(SKETCH_ID),
        ],
        "self-body",
    );

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.get(body)).toBe(1);
});

test("the capture-time anchor caps the rollback and anchors unconsumed bodies", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const consumed = addBody(doc, [extrude("other-sketch"), extrude(SKETCH_ID)], "consumed");
    const unconsumed = addBody(doc, [extrude("other-sketch"), extrude("other-sketch")], "unconsumed");
    const unanchored = addBody(doc, [extrude("other-sketch")], "unanchored");
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        id: SKETCH_ID,
        data: { entities: [], constraints: [], refPositions: { consumed: 1, unconsumed: 1 } },
    });
    doc.modelManager.addNode(sketch);

    const rollback = computeSketchRollback(doc, sketch);

    // min(consuming index 1, anchor 1)
    expect(rollback.get(consumed)).toBe(1);
    // no consuming feature — the anchor alone hides the later feature
    expect(rollback.get(unconsumed)).toBe(1);
    expect(rollback.has(unanchored)).toBe(false);
});

test("the anchor caps a consumer that was appended after more features", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    // sketch created when the body had 1 feature; another feature and the consuming
    // extrude came later — everything past the anchor hides
    const body = addBody(doc, [extrude("other-sketch"), extrude("other-sketch"), extrude(SKETCH_ID)], "body");
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        id: SKETCH_ID,
        data: { entities: [], constraints: [], refPositions: { body: 1 } },
    });
    doc.modelManager.addNode(sketch);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.get(body)).toBe(1);
});

test("an anchor at the feature count hides nothing and is not a rollback", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    // sketch created against the body's current tip — rolling back to it would be a
    // wasted full re-evaluation per editor session
    const body = addBody(doc, [extrude("other-sketch"), extrude("other-sketch")], "body");
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        id: SKETCH_ID,
        data: { entities: [], constraints: [], refPositions: { body: 2 } },
    });
    doc.modelManager.addNode(sketch);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.has(body)).toBe(false);
});

test("an anchor-rolled body propagates to its boolean consumer", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    // the tool is rolled back by its anchor alone; the consumer's boolean mixes
    // timelines unless it rolls back to the referencing feature too
    const tool = addBody(doc, [extrude("other-sketch"), extrude("other-sketch")], "tool");
    const consumer = addBody(doc, [extrude("other-sketch"), fuse("b1", ["tool"])], "consumer");
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        id: SKETCH_ID,
        data: { entities: [], constraints: [], refPositions: { tool: 1 } },
    });
    doc.modelManager.addNode(sketch);

    const rollback = computeSketchRollback(doc, sketch);

    expect(rollback.get(tool)).toBe(1);
    expect(rollback.get(consumer)).toBe(1);
});
