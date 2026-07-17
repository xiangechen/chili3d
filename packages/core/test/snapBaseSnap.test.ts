// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "../src/math";
import { ShapeTypes } from "../src/shape";
import type { MouseAndDetected, SnapResult } from "../src/snap/snap";
import { BaseSnap } from "../src/snap/snaps/baseSnap";
import type { IView, VisualShapeData } from "../src/visual";
import { VisualStates } from "../src/visual";
import { createMockHighlighter, createMockView, createMouseAndDetected } from "./mocks";

// ============================================================================
// Concrete BaseSnap subclass for testing
// ============================================================================

class TestBaseSnap extends BaseSnap {
    public snapCalls: MouseAndDetected[] = [];
    public snapReturnValue: SnapResult | undefined;

    snap(data: MouseAndDetected): SnapResult | undefined {
        this.snapCalls.push(data);
        return this.snapReturnValue;
    }

    // Expose protected methods for testing
    public testHighlight(shapes: VisualShapeData[]): void {
        this.highlight(shapes);
    }

    public testUnhighlight(): void {
        this.unhighlight();
    }

    public testAddTempMesh(view: IView, meshId: number): void {
        this.addTempMesh(view, meshId);
    }

    public testCalculateDistance(point: XYZ): number | undefined {
        return this.calculateDistance(point);
    }

    public get highlightedShapes(): VisualShapeData[] {
        return this._highlightedShapes;
    }
}

/**
 * Create a VisualShapeData mock with a given highlighter pre-wired.
 * The highlighter lives at shape.owner.node.document.visual.highlighter,
 * which is read-only, so we build the entire nested object with `as never`.
 */
function createMockVisualShapeWithHighlighter(highlighter: object): VisualShapeData {
    return {
        shape: { id: "s1", shapeType: ShapeTypes.edge },
        owner: {
            node: {
                id: "n1",
                document: { visual: { highlighter } },
            },
        },
        transform: {},
        indexes: [],
        point: undefined,
    } as never;
}

// ============================================================================
// BaseSnap
// ============================================================================

describe("BaseSnap", () => {
    describe("constructor", () => {
        test("should store referencePoint", () => {
            const ref = () => XYZ.zero;
            const snap = new TestBaseSnap(ref);
            expect(snap.referencePoint).toBe(ref);
        });

        test("should accept undefined referencePoint", () => {
            const snap = new TestBaseSnap(undefined);
            expect(snap.referencePoint).toBeUndefined();
        });
    });

    describe("highlight / unhighlight", () => {
        test("should highlight shapes using the highlighter", () => {
            const { highlighter, addCalls } = createMockHighlighter();
            const shape = createMockVisualShapeWithHighlighter(highlighter);

            const snap = new TestBaseSnap();
            snap.testHighlight([shape]);

            expect(addCalls.length).toBe(1);
            expect(addCalls[0].shape).toBe(shape.owner);
            expect(addCalls[0].state).toBe(VisualStates.edgeHighlight);
            expect(addCalls[0].type).toBe(shape.shape.shapeType);
            expect(snap.highlightedShapes.length).toBe(1);
        });

        test("should unhighlight all previously highlighted shapes", () => {
            const { highlighter, removeCalls } = createMockHighlighter();
            const shape = createMockVisualShapeWithHighlighter(highlighter);

            const snap = new TestBaseSnap();
            snap.testHighlight([shape]);
            expect(snap.highlightedShapes.length).toBe(1);

            snap.testUnhighlight();
            expect(removeCalls.length).toBe(1);
            expect(removeCalls[0].shape).toBe(shape.owner);
            expect(removeCalls[0].state).toBe(VisualStates.edgeHighlight);
        });
    });

    describe("temp mesh management", () => {
        test("should add temp mesh to a view", () => {
            const view = createMockView();
            const snap = new TestBaseSnap();

            snap.testAddTempMesh(view, 42);
            // Access protected _tempMeshIds via casting
            const tempIds = (snap as unknown as { _tempMeshIds: Map<IView, number[]> })._tempMeshIds;
            expect(tempIds.has(view)).toBe(true);
            const ids = tempIds.get(view);
            expect(ids).toContain(42);
        });

        test("should add multiple temp meshes to the same view", () => {
            const view = createMockView();
            const snap = new TestBaseSnap();

            snap.testAddTempMesh(view, 1);
            snap.testAddTempMesh(view, 2);
            snap.testAddTempMesh(view, 3);

            const tempIds = (snap as unknown as { _tempMeshIds: Map<IView, number[]> })._tempMeshIds;
            const ids = tempIds.get(view);
            expect(ids).toEqual([1, 2, 3]);
        });

        test("removeDynamicObject should clear temp meshes and unhighlight", () => {
            const { highlighter } = createMockHighlighter();
            const shape = createMockVisualShapeWithHighlighter(highlighter);

            const view = createMockView();
            const snap = new TestBaseSnap();
            snap.testHighlight([shape]);
            snap.testAddTempMesh(view, 99);

            snap.removeDynamicObject();

            // Temp meshes should be cleared
            const tempIds = (snap as unknown as { _tempMeshIds: Map<IView, number[]> })._tempMeshIds;
            expect(tempIds.size).toBe(0);
            // Highlighted shapes should be cleared
            expect(snap.highlightedShapes.length).toBe(0);
        });

        test("clear should call removeDynamicObject", () => {
            const view = createMockView();
            const snap = new TestBaseSnap();
            snap.testAddTempMesh(view, 99);

            snap.clear();

            const tempIds = (snap as unknown as { _tempMeshIds: Map<IView, number[]> })._tempMeshIds;
            expect(tempIds.size).toBe(0);
        });
    });

    describe("calculateDistance", () => {
        test("should return distance from referencePoint", () => {
            const ref = () => XYZ.zero;
            const snap = new TestBaseSnap(ref);

            const distance = snap.testCalculateDistance(new XYZ({ x: 3, y: 4, z: 0 }));
            expect(distance).toBeCloseTo(5, 5);
        });

        test("should return undefined when referencePoint is undefined", () => {
            const snap = new TestBaseSnap(undefined);

            const distance = snap.testCalculateDistance(new XYZ({ x: 10, y: 0, z: 0 }));
            expect(distance).toBeUndefined();
        });

        test("should return 0 for same point", () => {
            const ref = () => new XYZ({ x: 5, y: 5, z: 5 });
            const snap = new TestBaseSnap(ref);

            const distance = snap.testCalculateDistance(new XYZ({ x: 5, y: 5, z: 5 }));
            expect(distance).toBeCloseTo(0, 5);
        });
    });

    describe("snap delegation", () => {
        test("should call snap with MouseAndDetected data", () => {
            const snap = new TestBaseSnap();
            snap.snapReturnValue = { view: createMockView(), shapes: [], type: "feature" };

            const view = createMockView();
            const data = createMouseAndDetected(view);
            const result = snap.snap(data);

            expect(snap.snapCalls.length).toBe(1);
            expect(snap.snapCalls[0]).toBe(data);
            expect(result).toBe(snap.snapReturnValue);
        });
    });
});
