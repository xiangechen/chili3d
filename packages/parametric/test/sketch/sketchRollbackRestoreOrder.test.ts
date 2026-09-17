// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import type { BooleanFeatureData, ExtrudeFeatureData, FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { rollbackRestoreOrder } from "../../src/sketch/sketchRollback";

let featureSeq = 0;

function extrude(sketchId: string): ExtrudeFeatureData {
    return { id: `ex-${sketchId}-${featureSeq++}`, type: "extrude", sketchId, depth: 10 };
}

function cut(id: string, toolIds: string[]): BooleanFeatureData {
    return { id, type: "boolean", operation: "cut", toolIds };
}

function addBody(doc: TestDocument, features: FeatureData[], id: string): ParametricBodyNode {
    const body = new ParametricBodyNode({ document: doc, features, id });
    doc.modelManager.addNode(body);
    return body;
}

function rollbackOf(...bodies: ParametricBodyNode[]): Map<ParametricBodyNode, number> {
    return new Map(bodies.map((body, index) => [body, index]));
}

test("a consumer restores after the rolled-back source it references", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    // the map's insertion order can place the consumer first (seeded before the source propagated in)
    const consumer = addBody(doc, [extrude("sk"), cut("b1", ["source"])], "consumer");
    const source = addBody(doc, [extrude("sk")], "source");

    expect(rollbackRestoreOrder(rollbackOf(consumer, source))).toEqual([source, consumer]);
});

test("dependencies order transitively, whatever the insertion order", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const a = addBody(doc, [extrude("sk"), cut("ba", ["b"])], "a");
    const b = addBody(doc, [extrude("sk"), cut("bb", ["c"])], "b");
    const c = addBody(doc, [extrude("sk")], "c");

    expect(rollbackRestoreOrder(rollbackOf(a, b, c))).toEqual([c, b, a]);
});

test("unrelated bodies keep their insertion order", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const first = addBody(doc, [extrude("s1")], "first");
    const second = addBody(doc, [extrude("s2")], "second");
    const third = addBody(doc, [extrude("s3")], "third");

    expect(rollbackRestoreOrder(rollbackOf(first, second, third))).toEqual([first, second, third]);
});

test("unrelated bodies keep their relative order around a dependency chain", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const free1 = addBody(doc, [extrude("s1")], "free1");
    const consumer = addBody(doc, [extrude("sk"), cut("b1", ["source"])], "consumer");
    const free2 = addBody(doc, [extrude("s2")], "free2");
    const source = addBody(doc, [extrude("sk")], "source");

    expect(rollbackRestoreOrder(rollbackOf(free1, consumer, free2, source))).toEqual([
        free1,
        free2,
        source,
        consumer,
    ]);
});

test("a referenced body outside the rollback map is already settled and ignored", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const consumer = addBody(doc, [extrude("sk"), cut("b1", ["settled"])], "consumer");
    addBody(doc, [extrude("sk")], "settled");
    const rolled = addBody(doc, [extrude("sk")], "rolled");

    // `settled` never rolled back, so the consumer has no in-map dependency
    expect(rollbackRestoreOrder(rollbackOf(consumer, rolled))).toEqual([consumer, rolled]);
});

test("a self-sourced feature adds no dependency", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    // press-pull on the body's own face: the self-reference carries no dependency
    const body = addBody(
        doc,
        [{ id: "pp", type: "extrude", depth: 5, source: { nodeId: "self", profiles: [] } }, extrude("sk")],
        "self",
    );
    const other = addBody(doc, [extrude("sk")], "other");

    expect(rollbackRestoreOrder(rollbackOf(body, other))).toEqual([body, other]);
});

test("a dependency cycle falls back to insertion order for its members", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    const a = addBody(doc, [extrude("sk"), cut("ba", ["b"])], "a");
    const b = addBody(doc, [extrude("sk"), cut("bb", ["a"])], "b");
    const free = addBody(doc, [extrude("s1")], "free");

    // the cycle cannot order and must not loop; the unrelated body still restores first
    expect(rollbackRestoreOrder(rollbackOf(a, b, free))).toEqual([free, a, b]);
});
