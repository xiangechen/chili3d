// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane } from "@chili3d/core";
import { rs } from "@rstest/core";
import { WasmSystem } from "../../lib/garlic";
import {
    axisLineRefs,
    ConstraintKind,
    type ExternalRefData,
    originRef,
    SKETCH_ORIGIN_ID,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchData,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const EXT_LINE: ExternalRefData = {
    entityId: -100,
    nodeId: "src",
    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
    role: "reference",
    snapshot: [0, 0, 10, 0],
    type: "line",
};

const EXT_CIRCLE: ExternalRefData = {
    entityId: -101,
    nodeId: "src",
    edge: { kind: "circle", center: { x: 5, y: 5, z: 0 }, radius: 3, axis: { x: 0, y: 0, z: 1 } },
    role: "reference",
    snapshot: [5, 5, 3],
    type: "circle",
};

function dataWith(...refs: ExternalRefData[]): SketchData {
    return { entities: [], constraints: [], externalRefs: refs.map((ref) => ({ ...ref })) };
}

describe("fixed entities (datum and externals)", () => {
    test("datum ids are fixed: guards reject param edits and deletes, drags leave the datum in place", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            expect(solver.isFixed(SKETCH_ORIGIN_ID)).toBe(true);
            expect(solver.isFixed(SKETCH_X_AXIS_ID)).toBe(true);
            expect(solver.isFixed(SKETCH_Y_AXIS_ID)).toBe(true);

            expect(() => solver.setPointPosition(originRef(), 1, 1)).toThrow(/datum/);
            expect(() => solver.removeEntity(SKETCH_ORIGIN_ID)).toThrow(/datum/);
            expect(() => solver.removeEntity(SKETCH_X_AXIS_ID)).toThrow(/datum/);

            // a datum ref never joins a coincident group, so a drag has nothing to move
            expect(solver.coincidentGroup(originRef())).toEqual([originRef()]);
            solver.beginDrag([originRef()]);
            solver.dragTo(originRef(), 5, 5);
            solver.endDrag();
            expect(solver.pointOf(originRef())).toEqual([0, 0]);
            expect(solver.pointOf({ entityId: SKETCH_X_AXIS_ID, pointIndex: 1 })).toEqual([1, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("seeded externals are fixed: guards reject param edits, deletes and drags", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(1, 1, 2, 2);
            expect(solver.isFixed(EXT_LINE.entityId)).toBe(true);
            expect(solver.isFixed(line)).toBe(false);
            expect(solver.isFixed(42)).toBe(false);

            expect(() =>
                solver.setPointPosition({ entityId: EXT_LINE.entityId, pointIndex: 0 }, 1, 1),
            ).toThrow(/external reference/);
            expect(() => solver.removeEntity(EXT_LINE.entityId)).toThrow(/removeExternalEntity/);

            // the external ref never joins a coincident group; a drag leaves it in place
            const ref = { entityId: EXT_LINE.entityId, pointIndex: 0 };
            expect(solver.coincidentGroup(ref)).toEqual([ref]);
            solver.beginDrag([ref]);
            solver.dragTo(ref, 50, 50);
            solver.endDrag();
            expect(solver.pointOf(ref)).toEqual([0, 0]);
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 1 })).toEqual([10, 0]);

            // removeExternalEntity is the only delete path; the id stops being fixed
            solver.removeExternalEntity(EXT_LINE.entityId);
            expect(solver.isFixed(EXT_LINE.entityId)).toBe(false);
            expect(solver.entity(EXT_LINE.entityId)).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });

    test("external and datum reads never cross the wasm boundary after seeding", () => {
        const getParams = rs.spyOn(WasmSystem.prototype, "get_params");
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE));
        try {
            // seeding legitimately crossed the boundary; reads from here on must not
            getParams.mockClear();

            expect(solver.entity(EXT_LINE.entityId)).toEqual({
                id: EXT_LINE.entityId,
                type: "line",
                params: [0, 0, 10, 0],
            });
            expect(solver.entity(SKETCH_X_AXIS_ID)).toEqual({
                id: SKETCH_X_AXIS_ID,
                type: "line",
                params: [0, 0, 1, 0],
            });
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 1 })).toEqual([10, 0]);
            expect(solver.pointOf({ entityId: EXT_CIRCLE.entityId, pointIndex: 0 })).toEqual([5, 5]);
            expect(solver.pointOf(originRef())).toEqual([0, 0]);
            expect(solver.externalEntitiesData()).toEqual([
                { id: EXT_LINE.entityId, type: "line", params: [0, 0, 10, 0] },
                { id: EXT_CIRCLE.entityId, type: "circle", params: [5, 5, 3] },
            ]);
            expect(solver.entities()).toEqual([]);
            // a no-op reconcile reads the cache too: nothing moved, nothing crossed
            expect(solver.syncExternalRefs([{ ...EXT_LINE }, { ...EXT_CIRCLE }])).toBe(false);

            expect(getParams).not.toHaveBeenCalled();
        } finally {
            getParams.mockRestore();
            solver.dispose();
        }
    });

    test("solve converges with constraints targeting fixed entities, which stay put", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [{ entityId: line, pointIndex: 1 }, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            });

            const outcome = solver.solve(true);

            expect(outcome.result.startsWith("Ok")).toBe(true);
            expect(solver.pointOf({ entityId: line, pointIndex: 0 })).toEqual([0, 0]);
            expect(solver.pointOf({ entityId: line, pointIndex: 1 })[1]).toBeCloseTo(0, 6);
            // the fixed targets never moved
            expect(solver.entity(EXT_LINE.entityId)!.params).toEqual([0, 0, 10, 0]);
            expect(solver.pointOf(originRef())).toEqual([0, 0]);
            // the pinned external contributes zero dofs: 4 line dofs − 2 coincident − 1 on-line
            expect(outcome.dofs).toBe(1);
        } finally {
            solver.dispose();
        }
    });

    test("the entity cache mirrors external moves made through updateExternalEntity", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        const getParams = rs.spyOn(WasmSystem.prototype, "get_params");
        try {
            solver.updateExternalEntity(EXT_LINE.entityId, [0, 7, 10, 7]);
            getParams.mockClear();

            expect(solver.entity(EXT_LINE.entityId)!.params).toEqual([0, 7, 10, 7]);
            expect(solver.pointOf({ entityId: EXT_LINE.entityId, pointIndex: 0 })).toEqual([0, 7]);
            expect(solver.externalEntitiesData()[0].params).toEqual([0, 7, 10, 7]);
            expect(getParams).not.toHaveBeenCalled();
        } finally {
            getParams.mockRestore();
            solver.dispose();
        }
    });
});

describe("monotonic id counters", () => {
    test("real entity ids are never reused after a delete", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const a = solver.addLine(0, 0, 1, 1);
            const b = solver.addCircle(0, 0, 2);
            expect(a).toBe(1);
            expect(b).toBe(2);

            solver.removeEntity(a);
            const c = solver.addLine(3, 3, 4, 4);

            expect(c).toBe(3);
            expect(solver.entities().map((e) => e.id)).toEqual([2, 3]);
        } finally {
            solver.dispose();
        }
    });

    test("a freed external id is never reissued", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const first = solver.allocateExternalEntityId();
            expect(first).toBe(-100);
            solver.addExternalEntity({ ...EXT_LINE, entityId: first });

            // delete the lowest-id external entity, then allocate again
            solver.removeExternalEntity(first);
            const second = solver.allocateExternalEntityId();

            expect(second).toBeLessThan(first);
            solver.addExternalEntity({ ...EXT_LINE, entityId: second });
            expect(solver.toData().externalRefs!.map((ref) => ref.entityId)).toEqual([second]);
        } finally {
            solver.dispose();
        }
    });

    test("seeding an externally allocated id still advances the counter", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE));
        try {
            expect(solver.allocateExternalEntityId()).toBe(-102);
        } finally {
            solver.dispose();
        }
    });

    test("counters round-trip through toData/loadData", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            solver.addLine(0, 0, 1, 1);
            solver.addCircle(0, 0, 2);
            solver.removeEntity(1);
            solver.addExternalEntity({ ...EXT_LINE, entityId: solver.allocateExternalEntityId() });

            const data = solver.toData();
            expect(data.entityIdSeq).toBe(3);
            expect(data.externalIdSeq).toBe(-101);

            const restored = new SketchSolver(Plane.XY, data);
            try {
                expect(restored.addLine(5, 5, 6, 6)).toBe(3);
                expect(restored.allocateExternalEntityId()).toBe(-101);
                // and the restored state round-trips the bumped counters again
                const again = restored.toData();
                expect(again.entityIdSeq).toBe(4);
                expect(again.externalIdSeq).toBe(-102);
            } finally {
                restored.dispose();
            }
        } finally {
            solver.dispose();
        }
    });

    test("legacy data without counters initializes from the current max+1 / min-1", () => {
        const solver = new SketchSolver(Plane.XY, {
            entities: [
                { id: 5, type: "line", params: [0, 0, 1, 1] },
                { id: 9, type: "circle", params: [0, 0, 2] },
            ],
            constraints: [],
            externalRefs: [{ ...EXT_LINE }, { ...EXT_CIRCLE, entityId: -103, snapshot: [5, 5, 3] }],
        });
        try {
            expect(solver.addLine(2, 2, 3, 3)).toBe(10);
            expect(solver.allocateExternalEntityId()).toBe(-104);
        } finally {
            solver.dispose();
        }
    });

    test("serialized counters win over the derived fallback", () => {
        const solver = new SketchSolver(Plane.XY, {
            entities: [{ id: 5, type: "line", params: [0, 0, 1, 1] }],
            constraints: [],
            externalRefs: [{ ...EXT_LINE }],
            entityIdSeq: 42,
            externalIdSeq: -110,
        });
        try {
            expect(solver.addLine(2, 2, 3, 3)).toBe(42);
            expect(solver.allocateExternalEntityId()).toBe(-110);
        } finally {
            solver.dispose();
        }
    });

    test("reset restores the counters from the data", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            expect(solver.addLine(0, 0, 1, 1)).toBe(1);
            solver.reset({ entities: [], constraints: [], entityIdSeq: 7, externalIdSeq: -105 });
            expect(solver.addLine(0, 0, 1, 1)).toBe(7);
            expect(solver.allocateExternalEntityId()).toBe(-105);
            expect(solver.toData().entityIdSeq).toBe(8);
        } finally {
            solver.dispose();
        }
    });

    test("a pre-counter document round-trips without counters until an allocation", () => {
        const legacy: SketchData = {
            entities: [{ id: 1, type: "line", params: [0, 0, 1, 1] }],
            constraints: [],
        };
        const solver = new SketchSolver(Plane.XY, legacy);
        try {
            // byte-identical round-trip: a no-op session on a pre-counter document
            // must not change dataJson, or every sketch exit records history
            expect(solver.toData()).toEqual(legacy);

            solver.addLine(1, 1, 2, 2);
            const after = solver.toData();
            expect(after.entityIdSeq).toBe(3);
            expect(after.externalIdSeq).toBe(-100);
        } finally {
            solver.dispose();
        }
    });
});

describe("lastRemovedConstraintIds", () => {
    test("a type-flip reseed reports the cascaded constraint ids and still returns true", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            const distance = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: line, pointIndex: 1 },
                    { entityId: EXT_LINE.entityId, pointIndex: 1 },
                ],
                datum: 10,
            });
            solver.solve(true);
            expect(solver.lastRemovedConstraintIds).toEqual([]);

            const flipped: ExternalRefData = { ...EXT_LINE, type: "circle", snapshot: [5, 5, 3] };
            const changed = solver.syncExternalRefs([flipped]);

            expect(changed).toBe(true);
            expect([...solver.lastRemovedConstraintIds].sort()).toEqual([coincident, distance].sort());
            expect(solver.toData().constraints).toEqual([]);
            expect(solver.entity(EXT_LINE.entityId)).toEqual({
                id: EXT_LINE.entityId,
                type: "circle",
                params: [5, 5, 3],
            });
        } finally {
            solver.dispose();
        }
    });

    test("cleared at the start of every sync; unchanged refs leave it empty", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            solver.solve(true);

            // a type flip populates the signal…
            const flipped: ExternalRefData = { ...EXT_LINE, type: "circle", snapshot: [5, 5, 3] };
            solver.syncExternalRefs([flipped]);
            expect(solver.lastRemovedConstraintIds).toEqual([coincident]);

            // …an unchanged sync clears it again (and stays a no-op)
            expect(solver.syncExternalRefs([flipped])).toBe(false);
            expect(solver.lastRemovedConstraintIds).toEqual([]);

            // A drop reports exactly like a type flip: the dropped ref's constraints
            // die with it, and the editor drops their dimension anchors off this
            // list — an unreported removal would leave orphan anchors in
            // SketchData.anchors.
            const onFlipped = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: line, pointIndex: 1 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
                datum: 5,
            });
            expect(solver.syncExternalRefs([])).toBe(true);
            expect(solver.lastRemovedConstraintIds).toEqual([onFlipped]);
            expect(solver.entity(EXT_LINE.entityId)).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });

    test("a drop reports exactly the dropped ref's constraints (and nothing for a constraint-free ref)", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE));
        try {
            const line = solver.addLine(5, 5, 20, 5);
            const coincident = solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: EXT_LINE.entityId, pointIndex: 0 },
                ],
            });
            const distance = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: line, pointIndex: 1 },
                    { entityId: EXT_LINE.entityId, pointIndex: 1 },
                ],
                datum: 10,
            });
            // a constraint that does not touch the dropped ref survives unreported
            const horizontal = solver.addConstraint({
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: line, pointIndex: 0 },
                    { entityId: line, pointIndex: 1 },
                ],
            });
            solver.solve(true);

            expect(solver.syncExternalRefs([{ ...EXT_CIRCLE }])).toBe(true);
            expect([...solver.lastRemovedConstraintIds].sort()).toEqual([coincident, distance].sort());
            expect(solver.toData().constraints.map((c) => c.id)).toEqual([horizontal]);

            // dropping the constraint-free circle reports nothing
            expect(solver.syncExternalRefs([])).toBe(true);
            expect(solver.lastRemovedConstraintIds).toEqual([]);
        } finally {
            solver.dispose();
        }
    });
});

describe("timeline anchors (refPositions)", () => {
    const EXT_OTHER: ExternalRefData = {
        entityId: -102,
        nodeId: "other",
        edge: { kind: "line", start: { x: 0, y: 5, z: 0 }, end: { x: 10, y: 5, z: 0 } },
        role: "reference",
        snapshot: [0, 5, 10, 5],
        type: "line",
    };

    test("removing the last ref to a node drops its anchor; an emptied map goes back to absent", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE, EXT_OTHER));
        try {
            solver.recordRefPosition("src", 3);
            solver.recordRefPosition("other", 5);
            expect(solver.toData().refPositions).toEqual({ src: 3, other: 5 });

            // "src" still has EXT_CIRCLE — the anchor survives the first removal
            solver.removeExternalEntity(EXT_LINE.entityId);
            expect(solver.toData().refPositions).toEqual({ src: 3, other: 5 });

            // the last "src" ref takes the anchor with it; "other" is untouched
            solver.removeExternalEntity(EXT_CIRCLE.entityId);
            expect(solver.toData().refPositions).toEqual({ other: 5 });

            // a fully pruned map serializes as absent again (byte-identical round-trip)
            solver.removeExternalEntity(EXT_OTHER.entityId);
            expect(solver.toData().refPositions).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });

    test("a type-flip reseed preserves the source node's anchor", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE));
        try {
            solver.recordRefPosition("src", 3);

            const flipped: ExternalRefData = { ...EXT_LINE, type: "circle", snapshot: [5, 5, 3] };
            expect(solver.syncExternalRefs([flipped])).toBe(true);

            // EXT_LINE was the only ref to "src": the remove inside the reseed pruned
            // the anchor (and emptied the map) — the reseed must restore it
            expect(solver.toData().refPositions).toEqual({ src: 3 });
        } finally {
            solver.dispose();
        }
    });

    test("the plane owner's anchor survives the last-ref prune, across reset", () => {
        const solver = new SketchSolver(Plane.XY, dataWith(EXT_LINE, EXT_CIRCLE, EXT_OTHER));
        try {
            // the editor wires this from SketchNode.planeRef: "src" owns the face
            // the sketch sits on, so its anchor outlives the boundary refs
            solver.planeOwnerNodeId = "src";
            solver.recordRefPosition("src", 3);
            solver.recordRefPosition("other", 5);

            solver.removeExternalEntity(EXT_LINE.entityId);
            solver.removeExternalEntity(EXT_CIRCLE.entityId);
            // every "src" ref is gone — its anchor stays, "other" still prunes
            expect(solver.toData().refPositions).toEqual({ src: 3, other: 5 });
            solver.removeExternalEntity(EXT_OTHER.entityId);
            expect(solver.toData().refPositions).toEqual({ src: 3 });

            // node-level, not data-level: an undo/redo reset keeps the exemption
            solver.reset({ entities: [], constraints: [] });
            expect(solver.planeOwnerNodeId).toBe("src");
        } finally {
            solver.dispose();
        }
    });
});

describe("snapshot normalization", () => {
    test("a truncated snapshot seeds zero-padded instead of throwing", () => {
        const truncated: ExternalRefData = { ...EXT_LINE, snapshot: [0, 0, 10] };
        const solver = new SketchSolver(Plane.XY, dataWith(truncated));
        try {
            expect(solver.entity(EXT_LINE.entityId)).toEqual({
                id: EXT_LINE.entityId,
                type: "line",
                params: [0, 0, 10, 0],
            });
            // the same truncated data reconciles as a no-op (normalized on both sides)
            expect(solver.syncExternalRefs([{ ...truncated }])).toBe(false);
            // a genuine change is still detected through the normalization
            expect(solver.syncExternalRefs([{ ...truncated, snapshot: [0, 1, 10] }])).toBe(true);
            expect(solver.entity(EXT_LINE.entityId)!.params).toEqual([0, 1, 10, 0]);
        } finally {
            solver.dispose();
        }
    });

    test("an over-long snapshot is truncated to the param layout", () => {
        const padded: ExternalRefData = { ...EXT_CIRCLE, snapshot: [5, 5, 3, 99] };
        const solver = new SketchSolver(Plane.XY, dataWith(padded));
        try {
            expect(solver.entity(EXT_CIRCLE.entityId)!.params).toEqual([5, 5, 3]);
            expect(solver.syncExternalRefs([{ ...padded }])).toBe(false);
        } finally {
            solver.dispose();
        }
    });
});
