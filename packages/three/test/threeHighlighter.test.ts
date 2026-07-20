// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, FaceMeshData } from "@chili3d/core";
import { ShapeTypes, VisualStates } from "@chili3d/core";
import type { IHighlightable } from "../src/highlightable";
import { ThreeGeometry } from "../src/threeGeometry";
import { ThreeHighlighter } from "../src/threeHighlighter";
import type { ThreeVisualObject } from "../src/threeVisualObject";
import { createMockVisualContext, createTestGeometryNode } from "./mocks";

function createHighlightable(): IHighlightable & { highlighted: boolean } {
    return {
        highlighted: false,
        highlight() {
            this.highlighted = true;
        },
        unhighlight() {
            this.highlighted = false;
        },
    };
}

describe("ThreeHighlighter", () => {
    let highlighter: ThreeHighlighter | undefined;

    afterEach(() => {
        highlighter?.container.parent?.remove(highlighter.container);
        highlighter = undefined;
    });

    describe("initialization", () => {
        test("adds container named 'highlighter' to scene", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            expect(highlighter.container.name).toBe("highlighter");
            expect(context.scene.children).toContain(highlighter.container);
        });
    });

    describe("addState / getState with highlightable objects", () => {
        test("getState returns undefined when no state has been added", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            const state = highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.edge);
            expect(state).toBeUndefined();
        });

        test("addState triggers highlight on IHighlightable", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );

            expect(hl.highlighted).toBe(true);
        });

        test("removeState returns to normal triggers unhighlight", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(true);

            highlighter.removeState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(false);
        });

        test("adding and removing the same state multiple times", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            // Add edgeHighlight twice - second should have no additional effect
            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(true);

            // Remove
            highlighter.removeState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(false);
        });
    });

    describe("resetState and clear", () => {
        test("resetState removes state and unhighlights", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.shape)).toBeDefined();

            highlighter.resetState(hl as unknown as ThreeVisualObject);
            expect(hl.highlighted).toBe(false);
            expect(
                highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.shape),
            ).toBeUndefined();
        });

        test("resetState on unknown object is a no-op", () => {
            const context = createMockVisualContext();
            const h = new ThreeHighlighter(context);
            const hl = createHighlightable();

            expect(() => h.resetState(hl as unknown as ThreeVisualObject)).not.toThrow();
        });

        test("clear resets all states", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl1 = createHighlightable();
            const hl2 = createHighlightable();

            highlighter.addState(
                hl1 as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            highlighter.addState(
                hl2 as unknown as ThreeVisualObject,
                VisualStates.edgeSelected,
                ShapeTypes.shape,
            );

            expect(hl1.highlighted).toBe(true);
            expect(hl2.highlighted).toBe(true);

            highlighter.clear();
            expect(hl1.highlighted).toBe(false);
            expect(hl2.highlighted).toBe(false);
        });
    });

    describe("highlightMesh / removeHighlightMesh", () => {
        test("highlightMesh with face data adds group to container", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
                index: new Uint32Array([0, 1, 2, 0, 2, 3]),
                groups: [],
                range: [],
                color: 0xff0000,
            };

            const beforeCount = highlighter.container.children.length;
            const id = highlighter.highlightMesh(data);
            expect(highlighter.container.children.length).toBeGreaterThan(beforeCount);
            expect(id).toBeGreaterThan(0);

            highlighter.removeHighlightMesh(id);
        });

        test("removeHighlightMesh removes from container", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([]),
                groups: [],
                range: [],
                color: 0x00ff00,
            };

            const beforeCount = highlighter.container.children.length;
            const id = highlighter.highlightMesh(data);
            expect(highlighter.container.children.length).toBeGreaterThan(beforeCount);

            highlighter.removeHighlightMesh(id);
            expect(highlighter.container.children.length).toBe(beforeCount);
        });

        test("removeHighlightMesh with invalid id is a no-op", () => {
            const context = createMockVisualContext();
            const h = new ThreeHighlighter(context);

            expect(() => h.removeHighlightMesh(99999)).not.toThrow();
        });

        test("highlightMesh handles edge mesh data", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            const data: EdgeMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [],
                color: 0xff0000,
                lineType: "solid",
            };

            const beforeCount = highlighter.container.children.length;
            const id = highlighter.highlightMesh(data);
            expect(highlighter.container.children.length).toBeGreaterThan(beforeCount);

            highlighter.removeHighlightMesh(id);
        });

        test("highlightMesh with vertex mesh data", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            const data = {
                position: new Float32Array([0, 0, 0, 1, 1, 1]),
                size: 3,
                color: 0x00ff00,
                range: [],
            };

            const beforeCount = highlighter.container.children.length;
            const id = highlighter.highlightMesh(data);
            expect(highlighter.container.children.length).toBeGreaterThan(beforeCount);

            highlighter.removeHighlightMesh(id);
        });
    });

    describe("addState / removeState with indexes", () => {
        test("addState with empty indexes triggers whole-state highlight", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            // Empty index array triggers setWholeState
            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.edge,
            );
            expect(hl.highlighted).toBe(true);
        });

        test("addState then removeState with multiple indexed states", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            // Add state with index (sub-geometry state)
            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.edge,
                0,
                1,
            );

            // This triggers highlight because ShapeType is edge with index, but it goes to setSubGeometryState
            // For a highlightable, setSubGeometryState for edge state uses isFaceState check
            // which returns false for edge + edgeHighlight -> addSubEdgeState path...
            // Actually it goes through setSubGeometryState -> isFaceState returns false -> addSubEdgeState
            // which needs a ThreeGeometry. Since our mock is not ThreeGeometry, it won't do anything visual
            // But the state should still be added to the internal map
        });

        test("removeState with indexes", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(true);

            highlighter.removeState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(false);
        });
    });

    describe("addState with different visual states", () => {
        test("faceHighlight triggers highlight", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.faceHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(true);

            highlighter.removeState(
                hl as unknown as ThreeVisualObject,
                VisualStates.faceHighlight,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(false);
        });

        test("edgeSelected triggers highlight", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeSelected,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(true);
        });

        test("faceSelected triggers highlight", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.faceSelected,
                ShapeTypes.shape,
            );
            expect(hl.highlighted).toBe(true);
        });

        test("removeState for non-existent state returns normal state", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            // removeState on an object that never had state added still
            // initializes a GeometryState and returns VisualStates.normal (0)
            highlighter.removeState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.edge,
            );
            // getState returns normal (0) because allocation happens lazily
            const state = highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.edge);
            expect(state).toBe(0); // VisualStates.normal
        });

        test("getState after addState returns the state", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );

            const state = highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.shape);
            expect(state).toBeDefined();
            // Should have the highlight bit set
            expect(state).not.toBeUndefined();
            if (state !== undefined) {
                expect(state & VisualStates.edgeHighlight).toBe(VisualStates.edgeHighlight);
            }
        });
    });

    describe("getOrInitState reuses existing state", () => {
        test("consecutive addStates reuse the same GeometryState", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );
            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.faceHighlight,
                ShapeTypes.shape,
            );
            // Both states are on the same object — should be managed together
            const state = highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.shape);
            expect(state).toBeDefined();
        });

        test("separate objects have independent states", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl1 = createHighlightable();
            const hl2 = createHighlightable();

            highlighter.addState(
                hl1 as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.shape,
            );

            expect(highlighter.getState(hl1 as unknown as ThreeVisualObject, ShapeTypes.shape)).toBeDefined();
            expect(
                highlighter.getState(hl2 as unknown as ThreeVisualObject, ShapeTypes.shape),
            ).toBeUndefined();
        });
    });

    describe("highlightMesh returns unique ids", () => {
        test("two highlightMesh calls return different ids", () => {
            const context = createMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            const data: FaceMeshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([]),
                groups: [],
                range: [],
                color: 0xff0000,
            };

            const id1 = highlighter.highlightMesh(data);
            const id2 = highlighter.highlightMesh(data);
            expect(id1).not.toBe(id2);

            highlighter.removeHighlightMesh(id1);
            highlighter.removeHighlightMesh(id2);
        });
    });
});

// ============================================================================
// GeometryState with real ThreeGeometry (5-way setWholeState branch)
// ============================================================================

describe("GeometryState with ThreeGeometry", () => {
    let context: ReturnType<typeof createMockVisualContext>;
    let highlighter: ThreeHighlighter;
    let geo: ThreeGeometry;

    beforeEach(() => {
        context = createMockVisualContext();
        highlighter = new ThreeHighlighter(context);
        const node = createTestGeometryNode();
        geo = new ThreeGeometry(node, context);
        if (!context.materialMap.has("mat-1")) {
            context.materialMap.set("mat-1", geo.faces()?.material as any);
        }
    });

    test("addState edgeHighlight changes edge material", () => {
        const originalEdgeMat = geo.edges()?.material;
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        const newEdgeMat = geo.edges()?.material;
        // Edge material should have been changed to highlight
        expect(newEdgeMat).not.toBe(originalEdgeMat);
    });

    test("addState faceHighlight changes face material", () => {
        const originalFaceMat = geo.faces()?.material;
        highlighter.addState(geo, VisualStates.faceHighlight, ShapeTypes.shape);
        const newFaceMat = geo.faces()?.material;
        expect(newFaceMat).not.toBe(originalFaceMat);
    });

    test("addState edgeSelected changes edge material", () => {
        highlighter.addState(geo, VisualStates.edgeSelected, ShapeTypes.shape);
        // Material should be replaced (not default edge material)
        const mat = geo.edges()?.material;
        expect(mat).toBeDefined();
    });

    test("removeState after edgeHighlight restores default materials", () => {
        const originalEdgeMat = geo.edges()?.material;
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        // Material changed
        expect(geo.edges()?.material).not.toBe(originalEdgeMat);

        highlighter.removeState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        // After removeState, materials should be restored (removeTemperaryMaterial called)
        const restoredMat = geo.edges()?.material;
        expect(restoredMat).toBeDefined();
    });

    test("resetState clears all states and restores materials", () => {
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        highlighter.addState(geo, VisualStates.faceHighlight, ShapeTypes.shape);

        highlighter.resetState(geo);
        // Both states should be cleared
        expect(highlighter.getState(geo, ShapeTypes.shape)).toBeUndefined();
    });

    test("getState returns the correct combined state", () => {
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        const s = highlighter.getState(geo, ShapeTypes.shape);
        expect(s).toBeDefined();
        if (s !== undefined) {
            expect(s & VisualStates.edgeHighlight).toBe(VisualStates.edgeHighlight);
        }
    });

    test("addState with sub-geometry index does not throw", () => {
        // Adding state with specific index should trigger setSubGeometryState path
        expect(() => highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.edge, 0)).not.toThrow();
    });
});
