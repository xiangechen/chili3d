// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, XYZ } from "../src/math";
import {
    type AnnotationOptions,
    AnnotationTypes,
    RefInfiniteLineAnnotation,
    RefSegmentAnnotation,
    TextAnnotation,
} from "../src/model/annotation";
import { TestDocument } from "./mocks";

describe("AnnotationTypes", () => {
    test("should contain four annotation types", () => {
        expect(AnnotationTypes).toHaveLength(4);
        expect(AnnotationTypes).toContain("dimension");
        expect(AnnotationTypes).toContain("text");
        expect(AnnotationTypes).toContain("refInfiniteLine");
        expect(AnnotationTypes).toContain("refSegment");
    });
});

describe("TextAnnotation", () => {
    const doc = new TestDocument() as any;

    test("should create TextAnnotation with correct values", () => {
        const position = new XYZ({ x: 1, y: 2, z: 3 });
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position,
        });

        expect(anno.annotationType).toBe("text");
        expect(anno.name).toBe("test-text");
        expect(anno.content).toBe("Hello");
        expect(anno.position).toEqual(position);
    });

    test("should set and get content", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        anno.content = "Updated";
        expect(anno.content).toBe("Updated");
    });

    test("should set and get position", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        const newPos = new XYZ({ x: 10, y: 20, z: 30 });
        anno.position = newPos;
        expect(anno.position).toEqual(newPos);
    });

    test("should have default color", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        expect(anno.color).toBe(0xffff00);
    });

    test("should set and get color", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
            color: 0xff0000,
        });

        expect(anno.color).toBe(0xff0000);

        anno.color = 0x00ff00;
        expect(anno.color).toBe(0x00ff00);
    });

    test("should set visible from options", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
            visible: false,
        });

        expect(anno.visible).toBe(false);
    });

    test("should generate id when not provided", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        expect(anno.id).toBeDefined();
        expect(typeof anno.id).toBe("string");
    });

    test("should use provided id", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
            id: "custom-id",
        });

        expect(anno.id).toBe("custom-id");
    });

    test("display should return annotation key", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        expect(anno.display()).toBe("annotation");
    });

    test("boundingBox should return undefined", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        expect(anno.boundingBox()).toBeUndefined();
    });
});

describe("RefInfiniteLineAnnotation", () => {
    const doc = new TestDocument() as any;

    test("should create with correct values", () => {
        const point = new XYZ({ x: 1, y: 2, z: 3 });
        const direction = new XYZ({ x: 0, y: 1, z: 0 });

        const anno = new RefInfiniteLineAnnotation({
            document: doc,
            annotationType: "refInfiniteLine",
            name: "test-line",
            point,
            direction,
        });

        expect(anno.annotationType).toBe("refInfiniteLine");
        expect(anno.name).toBe("test-line");
        expect(anno.point).toEqual(point);
        expect(anno.direction).toEqual(direction);
    });

    test("should set and get point", () => {
        const anno = new RefInfiniteLineAnnotation({
            document: doc,
            annotationType: "refInfiniteLine",
            name: "test-line",
            point: XYZ.zero,
            direction: XYZ.unitX,
        });

        const newPoint = new XYZ({ x: 5, y: 5, z: 5 });
        anno.point = newPoint;
        expect(anno.point).toEqual(newPoint);
    });

    test("should set and get direction", () => {
        const anno = new RefInfiniteLineAnnotation({
            document: doc,
            annotationType: "refInfiniteLine",
            name: "test-line",
            point: XYZ.zero,
            direction: XYZ.unitX,
        });

        anno.direction = XYZ.unitZ;
        expect(anno.direction).toEqual(XYZ.unitZ);
    });

    test("boundingBox should return undefined", () => {
        const anno = new RefInfiniteLineAnnotation({
            document: doc,
            annotationType: "refInfiniteLine",
            name: "test-line",
            point: XYZ.zero,
            direction: XYZ.unitX,
        });

        expect(anno.boundingBox()).toBeUndefined();
    });

    test("should have default color 0xffff00", () => {
        const anno = new RefInfiniteLineAnnotation({
            document: doc,
            annotationType: "refInfiniteLine",
            name: "test-line",
            point: XYZ.zero,
            direction: XYZ.unitX,
        });

        expect(anno.color).toBe(0xffff00);
    });
});

describe("RefSegmentAnnotation", () => {
    const doc = new TestDocument() as any;

    test("should create with correct values", () => {
        const startPoint = new XYZ({ x: 0, y: 0, z: 0 });
        const endPoint = new XYZ({ x: 10, y: 0, z: 0 });

        const anno = new RefSegmentAnnotation({
            document: doc,
            annotationType: "refSegment",
            name: "test-segment",
            startPoint,
            endPoint,
        });

        expect(anno.annotationType).toBe("refSegment");
        expect(anno.name).toBe("test-segment");
        expect(anno.startPoint).toEqual(startPoint);
        expect(anno.endPoint).toEqual(endPoint);
    });

    test("should set and get startPoint", () => {
        const anno = new RefSegmentAnnotation({
            document: doc,
            annotationType: "refSegment",
            name: "test-segment",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
        });

        const newStart = new XYZ({ x: 1, y: 2, z: 3 });
        anno.startPoint = newStart;
        expect(anno.startPoint).toEqual(newStart);
    });

    test("should set and get endPoint", () => {
        const anno = new RefSegmentAnnotation({
            document: doc,
            annotationType: "refSegment",
            name: "test-segment",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
        });

        const newEnd = new XYZ({ x: 10, y: 20, z: 30 });
        anno.endPoint = newEnd;
        expect(anno.endPoint).toEqual(newEnd);
    });

    test("boundingBox should compute from start and end points", () => {
        const startPoint = new XYZ({ x: 1, y: 2, z: 3 });
        const endPoint = new XYZ({ x: 4, y: 5, z: 6 });

        const anno = new RefSegmentAnnotation({
            document: doc,
            annotationType: "refSegment",
            name: "test-segment",
            startPoint,
            endPoint,
        });

        const box = anno.boundingBox();
        expect(box).toBeDefined();
        expect(box!.min.x).toBe(1);
        expect(box!.min.y).toBe(2);
        expect(box!.min.z).toBe(3);
        expect(box!.max.x).toBe(4);
        expect(box!.max.y).toBe(5);
        expect(box!.max.z).toBe(6);
    });

    test("boundingBox should handle reversed points", () => {
        const startPoint = new XYZ({ x: 5, y: 5, z: 5 });
        const endPoint = new XYZ({ x: 1, y: 1, z: 1 });

        const anno = new RefSegmentAnnotation({
            document: doc,
            annotationType: "refSegment",
            name: "test-segment",
            startPoint,
            endPoint,
        });

        const box = anno.boundingBox();
        expect(box).toBeDefined();
        expect(box!.min.x).toBe(1);
        expect(box!.max.x).toBe(5);
    });
});
