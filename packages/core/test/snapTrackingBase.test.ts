// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../src/document";
import { XYZ } from "../src/math";
import type { SnapResult } from "../src/snap";
import { TrackingBase } from "../src/snap/tracking/trackingBase";
import { TestDocument } from "./mocks";

// ============================================================================
// Concrete TrackingBase subclass for testing
// ============================================================================

class TestTrackingBase extends TrackingBase {
    /** Access the protected isCleared field via bracket notation. */
    checkIsCleared(): boolean {
        return (this as unknown as { isCleared: boolean }).isCleared;
    }

    testAddTempMesh(document: IDocument, meshId: number): void {
        this.addTempMesh(document, meshId);
    }

    testDisplayPoint(document: IDocument, snap: SnapResult, size: number, color: number): number {
        return this.displayPoint(document, snap, size, color);
    }

    testClearTempMeshes(): void {
        this.clearTempMeshes();
    }
}

// ============================================================================
// TrackingBase
// ============================================================================

describe("TrackingBase", () => {
    describe("constructor", () => {
        test("should store trackingZ flag", () => {
            const tracking = new TestTrackingBase(true);
            expect(tracking.trackingZ).toBe(true);
        });

        test("should store trackingZ as false", () => {
            const tracking = new TestTrackingBase(false);
            expect(tracking.trackingZ).toBe(false);
        });
    });

    describe("clear", () => {
        test("should set isCleared to true and clear temp meshes", () => {
            const tracking = new TestTrackingBase(false);
            const doc = new TestDocument();

            const removedIds: number[] = [];
            doc.visual.context.displayMesh = () => 101;
            doc.visual.context.removeMesh = (id: number) => {
                removedIds.push(id);
            };

            tracking.testAddTempMesh(doc, 101);
            expect(tracking.checkIsCleared()).toBe(false);

            tracking.clear();
            expect(tracking.checkIsCleared()).toBe(true);
            expect(removedIds).toContain(101);
        });
    });

    describe("addTempMesh", () => {
        test("should add a mesh ID to a document", () => {
            const tracking = new TestTrackingBase(false);
            const doc = new TestDocument();

            tracking.testAddTempMesh(doc, 42);

            const removedIds: number[] = [];
            doc.visual.context.removeMesh = (id: number) => {
                removedIds.push(id);
            };

            tracking.clear();
            expect(removedIds).toContain(42);
        });

        test("should add multiple mesh IDs to the same document", () => {
            const tracking = new TestTrackingBase(false);
            const doc = new TestDocument();

            tracking.testAddTempMesh(doc, 1);
            tracking.testAddTempMesh(doc, 2);
            tracking.testAddTempMesh(doc, 3);

            const removedIds: number[] = [];
            doc.visual.context.removeMesh = (id: number) => {
                removedIds.push(id);
            };

            tracking.clear();
            expect(removedIds).toEqual([1, 2, 3]);
        });

        test("should handle multiple documents independently", () => {
            const tracking = new TestTrackingBase(false);
            const doc1 = new TestDocument();
            const doc2 = new TestDocument();

            tracking.testAddTempMesh(doc1, 10);
            tracking.testAddTempMesh(doc2, 20);

            const removedIds1: number[] = [];
            const removedIds2: number[] = [];
            doc1.visual.context.removeMesh = (id: number) => {
                removedIds1.push(id);
            };
            doc2.visual.context.removeMesh = (id: number) => {
                removedIds2.push(id);
            };

            tracking.clear();
            expect(removedIds1).toContain(10);
            expect(removedIds2).toContain(20);
        });
    });

    describe("clearTempMeshes", () => {
        test("should remove all temp meshes across all documents", () => {
            const tracking = new TestTrackingBase(false);
            const doc = new TestDocument();

            const removedIds: number[] = [];
            doc.visual.context.removeMesh = (id: number) => {
                removedIds.push(id);
            };

            tracking.testAddTempMesh(doc, 5);
            tracking.testAddTempMesh(doc, 6);
            tracking.testClearTempMeshes();

            expect(removedIds).toEqual([5, 6]);
        });
    });

    describe("displayPoint", () => {
        test("should create a vertex mesh and add it to temp meshes", () => {
            const tracking = new TestTrackingBase(false);
            const doc = new TestDocument();

            let displayedData: unknown;
            doc.visual.context.displayMesh = (data: unknown) => {
                displayedData = data;
                return 77;
            };

            const snap: SnapResult = {
                view: {} as never,
                shapes: [],
                type: "vertex",
                point: new XYZ({ x: 1, y: 2, z: 3 }),
            };

            const id = tracking.testDisplayPoint(doc, snap, 5, 0xff0000);
            expect(id).toBe(77);
            expect(displayedData).toBeDefined();

            const removedIds: number[] = [];
            doc.visual.context.removeMesh = (id: number) => {
                removedIds.push(id);
            };

            tracking.clear();
            expect(removedIds).toContain(77);
        });
    });
});
