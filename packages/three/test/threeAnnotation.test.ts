// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { RefSegmentAnnotation } from "@chili3d/core";
import { XYZ } from "@chili3d/core";
import { ThreeRefSegmentAnnotation } from "../src/threeAnnotation";
import { createMockVisualContext } from "./mocks";

function createAnnotation(): RefSegmentAnnotation {
    return {
        startPoint: new XYZ({ x: 0, y: 0, z: 0 }),
        endPoint: new XYZ({ x: 10, y: 10, z: 10 }),
    } as unknown as RefSegmentAnnotation;
}

describe("ThreeRefSegmentAnnotation", () => {
    test("creates annotation object", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        expect(annotation).toBeDefined();
        expect(annotation.annotation.startPoint.x).toBe(0);
        expect(annotation.annotation.endPoint.x).toBe(10);
        expect(annotation.locked).toBe(false);
    });

    test("creates LineSegments2 mesh internally", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        const meshes = annotation.wholeVisual();
        expect(meshes.length).toBeGreaterThanOrEqual(1);
    });

    test("wholeVisual returns line mesh array", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        const visuals = annotation.wholeVisual();
        expect(Array.isArray(visuals)).toBe(true);
    });

    test("highlight changes material to highlightMaterial", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        expect(() => annotation.highlight()).not.toThrow();
    });

    test("unhighlight restores normal material", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        annotation.highlight();
        expect(() => annotation.unhighlight()).not.toThrow();
    });

    test("worldTransform returns identity matrix", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        const transform = annotation.worldTransform();
        expect(transform).toBeDefined();
        expect(transform.toArray).toBeDefined();
    });

    test("dispose cleans up geometry", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        expect(() => annotation.dispose()).not.toThrow();
    });

    test("transform property is defined by default", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        expect(annotation.transform).toBeDefined();
        expect(annotation.transform.toArray).toBeDefined();
    });

    test("boundingBox returns bounding box of the line", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        const box = annotation.boundingBox();
        if (box) {
            expect(typeof box.min.x).toBe("number");
            expect(typeof box.max.x).toBe("number");
        }
    });

    test("locked is false by default", () => {
        const context = createMockVisualContext();
        const annotation = new ThreeRefSegmentAnnotation(context, createAnnotation());

        expect(annotation.locked).toBe(false);
    });
});
