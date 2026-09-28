// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "../src/math";
import {
    type AnnotationOptions,
    AnnotationTypes,
    DimensionAnnotation,
    RefInfiniteLineAnnotation,
    RefSegmentAnnotation,
    TextAnnotation,
} from "../src/model/annotation";
import { DIMENSION_TEXT_HEIGHT } from "../src/model/dimensionLayout";
import { InternalClassName, Serializer } from "../src/serialize";
import { TestDocument } from "../test-utils";

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

        expect(anno.id).not.toBeNull();
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

    test("keeps and serializes a leader point, positions the box around it", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: new XYZ({ x: 10, y: 0, z: 0 }),
            leaderPoint: new XYZ({ x: 0, y: 5, z: 0 }),
        });

        expect(anno.leaderPoint).toEqual(new XYZ({ x: 0, y: 5, z: 0 }));
        const box = anno.boundingBox()!;
        expect(box.min).toEqual(new XYZ({ x: 0, y: 0, z: 0 }));
        expect(box.max).toEqual(new XYZ({ x: 10, y: 5, z: 0 }));
    });

    test("a note without a leader still has a box, at its position", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: new XYZ({ x: 3, y: 4, z: 0 }),
        });

        expect(anno.leaderPoint).toBeUndefined();
        expect(anno.boundingBox()!.min).toEqual(new XYZ({ x: 3, y: 4, z: 0 }));
    });

    test("textHeight defaults to the drafting size and refuses a non-positive one", () => {
        const anno = new TextAnnotation({
            document: doc,
            annotationType: "text",
            name: "test-text",
            content: "Hello",
            position: XYZ.zero,
        });

        expect(anno.textHeight).toBe(DIMENSION_TEXT_HEIGHT);
        anno.textHeight = 0;
        expect(anno.textHeight).toBe(DIMENSION_TEXT_HEIGHT);
        anno.textHeight = 7;
        expect(anno.textHeight).toBe(7);
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
        expect(box).not.toBeNull();
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
        expect(box).not.toBeNull();
        expect(box!.min.x).toBe(1);
        expect(box!.max.x).toBe(5);
    });
});

describe("DimensionAnnotation", () => {
    const doc = new TestDocument() as any;

    test("should create with correct values and default dimensionType", () => {
        const startPoint = new XYZ({ x: 0, y: 0, z: 0 });
        const endPoint = new XYZ({ x: 3, y: 4, z: 0 });
        const textPoint = new XYZ({ x: 1.5, y: 6, z: 0 });

        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint,
            endPoint,
            textPoint,
        });

        expect(anno.annotationType).toBe("dimension");
        expect(anno.name).toBe("test-dimension");
        expect(anno.dimensionType).toBe("linear");
        expect(anno.startPoint).toEqual(startPoint);
        expect(anno.endPoint).toEqual(endPoint);
        expect(anno.textPoint).toEqual(textPoint);
    });

    test("value should derive from the attachment points", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: XYZ.zero,
        });

        expect(anno.value).toBeCloseTo(5);
        expect(anno.formattedValue()).toBe("5.00");
        expect(anno.formattedValue(1)).toBe("5.0");
    });

    test("should set and get points", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
            textPoint: XYZ.zero,
        });

        const newEnd = new XYZ({ x: 10, y: 0, z: 0 });
        anno.endPoint = newEnd;
        expect(anno.endPoint).toEqual(newEnd);
        expect(anno.value).toBeCloseTo(10);

        const newText = new XYZ({ x: 5, y: 8, z: 0 });
        anno.textPoint = newText;
        expect(anno.textPoint).toEqual(newText);
    });

    test("display should return annotation.dimension key", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
            textPoint: XYZ.zero,
        });

        expect(anno.display()).toBe("annotation.dimension");
    });

    test("boundingBox should cover all three points", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 10, y: 0, z: 0 }),
            textPoint: new XYZ({ x: 5, y: -3, z: 2 }),
        });

        const box = anno.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.min).toEqual(new XYZ({ x: 0, y: -3, z: 0 }));
        expect(box!.max).toEqual(new XYZ({ x: 10, y: 0, z: 2 }));
    });

    test("textHeight defaults to the drafting height and refuses non-positive values", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
            textPoint: XYZ.zero,
        });

        expect(anno.textHeight).toBeCloseTo(3.5);

        anno.textHeight = 7;
        expect(anno.textHeight).toBe(7);

        anno.textHeight = 0;
        expect(anno.textHeight).toBe(7);
        anno.textHeight = -2;
        expect(anno.textHeight).toBe(7);
    });

    test("textHeight can be given at construction", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
            textPoint: XYZ.zero,
            textHeight: 5,
        });

        expect(anno.textHeight).toBe(5);
    });

    test("textOverride replaces the measured value and expands the <> placeholder", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: XYZ.zero,
        });

        expect(anno.textOverride).toBe("");
        expect(anno.formattedValue()).toBe("5.00");

        anno.textOverride = "custom";
        expect(anno.formattedValue()).toBe("custom");

        anno.textOverride = "Ø<> ±0.1";
        expect(anno.formattedValue()).toBe("Ø5.00 ±0.1");

        anno.textOverride = "";
        expect(anno.formattedValue()).toBe("5.00");
    });

    test("textOverride can be given at construction and survives serialization", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: XYZ.zero,
            textOverride: "Ø<>",
        });

        expect(anno.textOverride).toBe("Ø<>");
        expect(anno.formattedValue()).toBe("Ø5.00");

        const restored = Serializer.deserializeObject(
            doc,
            Serializer.serializeObject(anno),
        ) as DimensionAnnotation;
        expect(restored.textOverride).toBe("Ø<>");
        expect(restored.formattedValue()).toBe("Ø5.00");
    });

    test("should survive a serialization roundtrip", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "test-dimension",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: new XYZ({ x: 1.5, y: 6, z: 0 }),
            color: 0xff0000,
            textHeight: 5,
        });

        const serialized = Serializer.serializeObject(anno);
        expect(serialized[InternalClassName]).toBe("DimensionAnnotation");

        const restored = Serializer.deserializeObject(doc, serialized) as DimensionAnnotation;
        expect(restored).toBeInstanceOf(DimensionAnnotation);
        expect(restored.dimensionType).toBe("linear");
        expect(restored.startPoint).toEqual(XYZ.zero);
        expect(restored.endPoint).toEqual(new XYZ({ x: 3, y: 4, z: 0 }));
        expect(restored.textPoint).toEqual(new XYZ({ x: 1.5, y: 6, z: 0 }));
        expect(restored.textHeight).toBe(5);
        expect(restored.color).toBe(0xff0000);
        expect(restored.value).toBeCloseTo(5);
    });

    test("radial and diameter dimensions carry the R / Ø prefixes", () => {
        const radial = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "radial",
            dimensionType: "radial",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: new XYZ({ x: 8, y: 4, z: 0 }),
        });
        expect(radial.value).toBeCloseTo(5);
        expect(radial.formattedValue()).toBe("R5.00");

        const diameter = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "diameter",
            dimensionType: "diameter",
            startPoint: new XYZ({ x: -3, y: -4, z: 0 }),
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: new XYZ({ x: 12, y: 4, z: 0 }),
        });
        expect(diameter.value).toBeCloseTo(10);
        expect(diameter.formattedValue()).toBe("Ø10.00");

        // the override stays the full text — no affixes added
        radial.textOverride = "drill <>";
        expect(radial.formattedValue()).toBe("drill 5.00");
    });

    test("an angular dimension reports the drawn sweep in degrees, reflex included", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "angular",
            dimensionType: "angular",
            centerPoint: XYZ.zero,
            startPoint: XYZ.unitX,
            endPoint: XYZ.unitY,
            textPoint: new XYZ({ x: 2, y: 2, z: 0 }),
        });

        expect(anno.value).toBeCloseTo(90);
        expect(anno.formattedValue()).toBe("90.0°");

        // dragging the text to the far side draws (and reports) the reflex angle
        anno.textPoint = new XYZ({ x: -2, y: -2, z: 0 });
        expect(anno.value).toBeCloseTo(270);
        expect(anno.formattedValue()).toBe("270.0°");
    });

    test("an angular dimension without a vertex falls back to the point distance", () => {
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "angular",
            dimensionType: "angular",
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 3, y: 4, z: 0 }),
            textPoint: XYZ.zero,
        });

        expect(anno.centerPoint).toBeUndefined();
        expect(anno.value).toBeCloseTo(5);
    });

    test("centerPoint survives a serialization roundtrip, absent stays absent", () => {
        const center = new XYZ({ x: 1, y: 2, z: 3 });
        const anno = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "angular",
            dimensionType: "angular",
            centerPoint: center,
            startPoint: center.add(XYZ.unitX),
            endPoint: center.add(XYZ.unitY),
            textPoint: center.add(new XYZ({ x: 2, y: 2, z: 0 })),
        });

        const restored = Serializer.deserializeObject(
            doc,
            Serializer.serializeObject(anno),
        ) as DimensionAnnotation;
        expect(restored.dimensionType).toBe("angular");
        expect(restored.centerPoint).toEqual(center);
        expect(restored.value).toBeCloseTo(90);

        const linear = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "linear",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
            textPoint: XYZ.zero,
        });
        const restoredLinear = Serializer.deserializeObject(
            doc,
            Serializer.serializeObject(linear),
        ) as DimensionAnnotation;
        expect(restoredLinear.centerPoint).toBeUndefined();
    });

    test("planeNormal survives a serialization roundtrip, absent stays absent", () => {
        const radial = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "radial",
            dimensionType: "radial",
            planeNormal: XYZ.unitZ,
            startPoint: XYZ.zero,
            endPoint: new XYZ({ x: 10, y: 0, z: 0 }),
            textPoint: new XYZ({ x: 20, y: 0, z: 0 }),
        });

        const restored = Serializer.deserializeObject(
            doc,
            Serializer.serializeObject(radial),
        ) as DimensionAnnotation;
        expect(restored.planeNormal).toEqual(XYZ.unitZ);

        const linear = new DimensionAnnotation({
            document: doc,
            annotationType: "dimension",
            name: "linear",
            startPoint: XYZ.zero,
            endPoint: XYZ.unitX,
            textPoint: XYZ.zero,
        });
        const restoredLinear = Serializer.deserializeObject(
            doc,
            Serializer.serializeObject(linear),
        ) as DimensionAnnotation;
        expect(restoredLinear.planeNormal).toBeUndefined();
    });
});
