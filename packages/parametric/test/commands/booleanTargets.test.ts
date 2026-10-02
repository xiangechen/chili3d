// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AUTO_TARGETS,
    BoundingBox,
    Matrix4,
    Result,
    ShapeTypes,
    type TargetSelection,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import {
    candidateBodies,
    commitBooleanTargets,
    resolveTargetBodies,
    sameTargetIds,
    standaloneBody,
    syncAutoTargets,
    targetCandidate,
} from "../../src/commands/booleanTargets";
import type { FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

/** A 10-cube from `min`. */
const boxAt = (x: number, y: number, z: number) =>
    new BoundingBox(new XYZ({ x, y, z }), new XYZ({ x: x + 10, y: y + 10, z: z + 10 }));

function scenario() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** A body whose LOCAL shape is a 10-cube, placed by its transform. */
function addBody(doc: TestDocument, id: string, transform = Matrix4.identity()) {
    const body = new ParametricBodyNode({ document: doc, id, features: [] });
    (body as any)._shape = Result.ok({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: () => {},
        findSubShapes: () => [],
        boundingBox: () => boxAt(0, 0, 0),
    });
    (body as any).setPrivateValue("transform", transform);
    doc.modelManager.addNode(body);
    return body;
}

const explicit = (ids: string[]): TargetSelection => ({ auto: false, ids });

describe("resolveTargetBodies", () => {
    test("auto speaks for the tool as it stands now", () => {
        const doc = scenario();
        const near = addBody(doc, "b1");
        addBody(doc, "b2", Matrix4.fromTranslation(100, 0, 0));

        expect(resolveTargetBodies(doc, boxAt(5, 5, 5), AUTO_TARGETS)).toEqual([near]);
    });

    test("auto with no box at all has nothing to speak for", () => {
        const doc = scenario();
        addBody(doc, "b1");

        expect(resolveTargetBodies(doc, undefined, AUTO_TARGETS)).toEqual([]);
    });

    test("an explicit choice is kept even where the boxes no longer meet", () => {
        const doc = scenario();
        const near = addBody(doc, "b1");
        const far = addBody(doc, "b2", Matrix4.fromTranslation(100, 0, 0));

        // Naming a body is what a user does when the detection would not have picked it.
        expect(resolveTargetBodies(doc, boxAt(5, 5, 5), explicit(["b1", "b2"]))).toEqual([near, far]);
    });

    test("drops the chosen bodies that are gone, and never names one twice", () => {
        const doc = scenario();
        const body = addBody(doc, "b1");

        expect(resolveTargetBodies(doc, undefined, explicit(["b1", "b1", "deleted"]))).toEqual([body]);
    });
});

describe("syncAutoTargets", () => {
    test("hands the detection's set to the command while it is still auto", () => {
        const doc = scenario();
        const body = addBody(doc, "b1");
        const written: TargetSelection[] = [];

        syncAutoTargets(doc, boxAt(5, 5, 5), AUTO_TARGETS, (next) => written.push(next));

        expect(written).toEqual([{ auto: true, ids: [body.id] }]);
    });

    test("writes nothing when the set the detection found is the one already held", () => {
        const doc = scenario();
        const body = addBody(doc, "b1");
        const written: TargetSelection[] = [];

        // The preview re-asks on every drag tick; an unchanged set must not repaint the panel.
        syncAutoTargets(doc, boxAt(5, 5, 5), { auto: true, ids: [body.id] }, (next) => written.push(next));

        expect(written).toEqual([]);
    });

    test("leaves an edited set alone", () => {
        const doc = scenario();
        addBody(doc, "b1");
        const written: TargetSelection[] = [];

        syncAutoTargets(doc, boxAt(5, 5, 5), explicit([]), (next) => written.push(next));

        expect(written).toEqual([]);
    });
});

describe("sameTargetIds", () => {
    test("is order-free, and counts duplicates", () => {
        expect(sameTargetIds(["a", "b"], ["b", "a"])).toBe(true);
        expect(sameTargetIds(["a", "b"], ["a"])).toBe(false);
        expect(sameTargetIds(["a"], ["a", "a"])).toBe(false);
    });
});

describe("commitBooleanTargets", () => {
    const feature: FeatureData = {
        id: "f1",
        type: "loft",
        sections: [],
        isSolid: true,
        isRuled: false,
        continuity: "c2",
    };

    test("appends the feature to every target, each with an id of its own", () => {
        const doc = scenario();
        const first = addBody(doc, "b1");
        const second = addBody(doc, "b2");

        commitBooleanTargets(doc, feature, "cut", [first, second]);

        expect(first.features).toHaveLength(1);
        expect(second.features).toHaveLength(1);
        expect(first.features[0]).toMatchObject({ type: "loft", operation: "cut" });
        expect(second.features[0]).toMatchObject({ type: "loft", operation: "cut" });
        // Distinct ids: a feature id is only ever resolved inside one body's chain, but
        // nothing should ever alias across bodies either.
        expect(first.features[0].id).not.toBe(second.features[0].id);
    });

    test("with nothing to combine with, stands the feature up as its own body", () => {
        const doc = scenario();

        commitBooleanTargets(doc, feature, "cut", []);

        const bodies = doc.modelManager.findNodes((node) => node instanceof ParametricBodyNode);
        expect(bodies).toHaveLength(1);
        // No body to combine with, so no operation to store: the feature stands alone.
        expect((bodies[0] as ParametricBodyNode).features[0]).toEqual(feature);
        expect((bodies[0] as ParametricBodyNode).features[0]).not.toHaveProperty("operation");
    });

    test("standaloneBody puts the feature on a body of its own", () => {
        const doc = scenario();

        standaloneBody(doc, feature);

        const bodies = doc.modelManager.findNodes((node) => node instanceof ParametricBodyNode);
        expect((bodies[0] as ParametricBodyNode).features).toEqual([feature]);
    });
});

describe("candidateBodies", () => {
    test("lists every body, in tree order, under the name the tree shows", () => {
        const doc = scenario();
        const first = addBody(doc, "b1");
        const second = addBody(doc, "b2");

        expect(candidateBodies(doc)).toEqual([first, second]);
        expect(targetCandidate(second)).toEqual({ id: "b2", label: second.name });
    });
});
