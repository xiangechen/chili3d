// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { EdgeMeshData, FaceMeshData } from "@chili3d/core";
import { ShapeTypes, VisualStates } from "@chili3d/core";
import type { IHighlightable } from "../src/highlightable";
import { ThreeHighlighter } from "../src/threeHighlighter";
import type { ThreeVisualObject } from "../src/threeVisualObject";
import { createMockVisualContext } from "./mocks";

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
    });
});
