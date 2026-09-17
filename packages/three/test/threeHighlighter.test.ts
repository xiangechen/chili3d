// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, FaceMeshData } from "@chili3d/core";
import { ShapeTypes, VisualStates, VisualStateUtils } from "@chili3d/core";
import type { Mesh } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { IHighlightable } from "../src/highlightable";
import {
    defaultEdgeMaterial,
    faceTransparentMaterial,
    hilightEdgeMaterial,
    selectedEdgeMaterial,
} from "../src/materials";
import { ThreeGeometry } from "../src/threeGeometry";
import { ThreeHighlighter } from "../src/threeHighlighter";
import type { ThreeVisualObject } from "../src/threeVisualObject";
import { createTestGeometryNode, createThreeMockVisualContext } from "./mocks";

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
            const context = createThreeMockVisualContext();
            highlighter = new ThreeHighlighter(context);

            expect(highlighter.container.name).toBe("highlighter");
            expect(context.scene.children).toContain(highlighter.container);
        });
    });

    describe("addState / getState with highlightable objects", () => {
        test("getState returns undefined when no state has been added", () => {
            const context = createThreeMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            const state = highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.edge);
            expect(state).toBeUndefined();
        });

        test("addState triggers highlight on IHighlightable", () => {
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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

        test("resetState on unknown object leaves its highlight untouched", () => {
            const context = createThreeMockVisualContext();
            const h = new ThreeHighlighter(context);
            const hl = createHighlightable();

            h.resetState(hl as unknown as ThreeVisualObject);
            expect(hl.highlighted).toBe(false);
            expect(h.getState(hl as unknown as ThreeVisualObject, ShapeTypes.shape)).toBeUndefined();
        });

        test("clear resets all states", () => {
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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

        test("removeHighlightMesh with invalid id leaves the container unchanged", () => {
            const context = createThreeMockVisualContext();
            const h = new ThreeHighlighter(context);

            h.removeHighlightMesh(99999);
            expect(h.container.children.length).toBe(0);
        });

        test("highlightMesh handles edge mesh data", () => {
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
            highlighter = new ThreeHighlighter(context);
            const hl = createHighlightable();

            // Indexed states go through setSubGeometryState -> addSubEdgeState, which
            // needs a ThreeGeometry to clone sub-edge geometry. A plain highlightable
            // stores no state and gets no visual change.
            highlighter.addState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.edge,
                0,
                1,
            );
            expect(hl.highlighted).toBe(false);
            expect(
                highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.edge, 0),
            ).toBeUndefined();

            // Removing the same indexed states is a safe no-op
            highlighter.removeState(
                hl as unknown as ThreeVisualObject,
                VisualStates.edgeHighlight,
                ShapeTypes.edge,
                0,
                1,
            );
            expect(hl.highlighted).toBe(false);
            expect(
                highlighter.getState(hl as unknown as ThreeVisualObject, ShapeTypes.edge, 0),
            ).toBeUndefined();
        });

        test("removeState with indexes", () => {
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            expect(state! & VisualStates.edgeHighlight).toBe(VisualStates.edgeHighlight);
        });
    });

    describe("getOrInitState reuses existing state", () => {
        test("consecutive addStates reuse the same GeometryState", () => {
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
            const context = createThreeMockVisualContext();
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
    let context: ReturnType<typeof createThreeMockVisualContext>;
    let highlighter: ThreeHighlighter;
    let geo: ThreeGeometry;
    /** A ghosted face that also shows its boundary — what the extrude pick selects. */
    const GHOSTED_OUTLINED_FACE = VisualStateUtils.addState(
        VisualStates.faceTransparent,
        VisualStates.edgeSelected,
    );

    beforeEach(() => {
        context = createThreeMockVisualContext();
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
        expect(newEdgeMat).toBe(hilightEdgeMaterial);
        expect(newEdgeMat).not.toBe(originalEdgeMat);
    });

    test("addState faceHighlight changes face material", () => {
        const originalFaceMat = geo.faces()?.material;
        highlighter.addState(geo, VisualStates.faceHighlight, ShapeTypes.shape);
        const newFaceMat = geo.faces()?.material;
        expect(newFaceMat).not.toBe(originalFaceMat);
    });

    test("addState edgeSelected changes edge material to the selected material", () => {
        const originalEdgeMat = geo.edges()?.material;
        highlighter.addState(geo, VisualStates.edgeSelected, ShapeTypes.shape);
        expect(geo.edges()?.material).toBe(selectedEdgeMaterial);
        expect(geo.edges()?.material).not.toBe(originalEdgeMat);
    });

    test("removeState after edgeHighlight restores default materials", () => {
        const originalEdgeMat = geo.edges()?.material;
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        // Material changed
        expect(geo.edges()?.material).not.toBe(originalEdgeMat);

        highlighter.removeState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        // After removeState, materials should be restored (removeTemperaryMaterial called)
        expect(geo.edges()?.material).toBe(defaultEdgeMaterial);
        expect(geo.edges()?.material).toBe(originalEdgeMat);
    });

    test("resetState clears all states and restores materials", () => {
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        highlighter.addState(geo, VisualStates.faceHighlight, ShapeTypes.shape);

        highlighter.resetState(geo);
        // Both states should be cleared
        expect(highlighter.getState(geo, ShapeTypes.shape)).toBeUndefined();
        expect(geo.edges()?.material).toBe(defaultEdgeMaterial);
    });

    test("getState returns the correct combined state", () => {
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.shape);
        const s = highlighter.getState(geo, ShapeTypes.shape);
        expect(s).toBeDefined();
        expect(s! & VisualStates.edgeHighlight).toBe(VisualStates.edgeHighlight);
    });

    test("addState with sub-geometry index clones the sub-edge into the container", () => {
        const beforeCount = highlighter.container.children.length;
        highlighter.addState(geo, VisualStates.edgeHighlight, ShapeTypes.edge, 0);

        expect(highlighter.container.children.length).toBe(beforeCount + 1);
        expect(highlighter.getState(geo, ShapeTypes.edge, 0)).toBe(VisualStates.edgeHighlight);
    });

    test("a state carrying a fill and an outline draws both for a face", () => {
        const beforeCount = highlighter.container.children.length;
        highlighter.addState(geo, GHOSTED_OUTLINED_FACE, ShapeTypes.face, 0);

        // the transparent fill and the boundary outline are two objects — the face's
        // outline comes from the face's own mesh, the caller never names its edges
        const drawn = highlighter.container.children.slice(beforeCount);
        expect(drawn).toHaveLength(2);
        expect((drawn[0] as Mesh).material).toBe(faceTransparentMaterial);
        expect((drawn[1] as LineSegments2).material).toBe(selectedEdgeMaterial);
        expect(highlighter.getState(geo, ShapeTypes.face, 0)).toBe(GHOSTED_OUTLINED_FACE);
    });

    test("dropping the outline flag leaves the fill in place", () => {
        highlighter.addState(geo, GHOSTED_OUTLINED_FACE, ShapeTypes.face, 0);
        const beforeCount = highlighter.container.children.length;

        highlighter.removeState(geo, VisualStates.edgeSelected, ShapeTypes.face, 0);

        const drawn = highlighter.container.children.slice(beforeCount - 2);
        expect(drawn).toHaveLength(1);
        expect((drawn[0] as Mesh).material).toBe(faceTransparentMaterial);
        expect(highlighter.getState(geo, ShapeTypes.face, 0)).toBe(VisualStates.faceTransparent);
    });

    test("removing every flag takes both objects away", () => {
        const beforeCount = highlighter.container.children.length;
        highlighter.addState(geo, GHOSTED_OUTLINED_FACE, ShapeTypes.face, 0);

        highlighter.removeState(geo, GHOSTED_OUTLINED_FACE, ShapeTypes.face, 0);

        expect(highlighter.container.children.length).toBe(beforeCount);
        expect(highlighter.getState(geo, ShapeTypes.face, 0)).toBeUndefined();
    });
});
