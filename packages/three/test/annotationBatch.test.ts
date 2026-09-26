// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { Group, type InterleavedBufferAttribute, type Mesh } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { AnnotationBatch, type IBatchedAnnotation } from "../src/annotationBatch";
import { createThreeMockVisualContext } from "./mocks";

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function createContext() {
    const context = createThreeMockVisualContext();
    const update = rs.fn();
    (context as { visual: unknown }).visual = { update };
    return { context, update };
}

function writerOf(overrides: Partial<IBatchedAnnotation> = {}): IBatchedAnnotation {
    return {
        batchVisible: true,
        batchColor: 0xff0000,
        buildLineSegments: (target) => target.push(0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0),
        buildTriangles: (target) => target.push(0, 0, 0, 1, 0, 0, 0, 1, 0),
        ...overrides,
    };
}

function linesOf(batch: AnnotationBatch): LineSegments2 {
    return batch.pickObjects()[0] as LineSegments2;
}

function textsOf(batch: AnnotationBatch): Mesh {
    return batch.pickObjects()[1] as Mesh;
}

function linePositions(batch: AnnotationBatch): Float32Array {
    const attribute = linesOf(batch).geometry.getAttribute("instanceStart") as InterleavedBufferAttribute;
    return attribute.data.array as Float32Array;
}

describe("AnnotationBatch", () => {
    test("merges every writer's geometry into one line object and one triangle mesh", async () => {
        const { context } = createContext();
        const batch = new AnnotationBatch(context, () => {});
        batch.register(writerOf());
        batch.register(writerOf());
        await flush();

        expect(linePositions(batch).length).toBe(2 * 2 * 6);
        const positions = textsOf(batch).geometry.getAttribute("position");
        expect(positions.count).toBe(2 * 3);
        expect(linesOf(batch).visible).toBe(true);
        expect(textsOf(batch).visible).toBe(true);
    });

    test("skips writers that are not batch-visible", async () => {
        const { context } = createContext();
        const batch = new AnnotationBatch(context, () => {});
        batch.register(writerOf({ batchVisible: false }));
        batch.register(writerOf());
        await flush();

        expect(linePositions(batch).length).toBe(12);
        expect(batch.annotationOf(linesOf(batch), 0)).toBeDefined();
    });

    test("starts with nothing visible until the first rebuild arrives", () => {
        const { context } = createContext();
        const batch = new AnnotationBatch(context, () => {});

        expect(linesOf(batch).visible).toBe(false);
        expect(textsOf(batch).visible).toBe(false);
    });

    test("maps a pick index back to its annotation", async () => {
        const { context } = createContext();
        const batch = new AnnotationBatch(context, () => {});
        const first = writerOf();
        const second = writerOf();
        batch.register(first);
        batch.register(second);
        await flush();

        expect(batch.annotationOf(linesOf(batch), 0)).toBe(first);
        expect(batch.annotationOf(linesOf(batch), 1)).toBe(first);
        expect(batch.annotationOf(linesOf(batch), 2)).toBe(second);
        expect(batch.annotationOf(textsOf(batch), 0)).toBe(first);
        expect(batch.annotationOf(textsOf(batch), 1)).toBe(second);
        expect(batch.annotationOf(new Group(), 0)).toBeUndefined();
        expect(batch.annotationOf(linesOf(batch), undefined)).toBeUndefined();
    });

    test("writes each slice in its writer's color", async () => {
        const { context } = createContext();
        const batch = new AnnotationBatch(context, () => {});
        batch.register(writerOf({ batchColor: 0xff0000 }));
        batch.register(writerOf({ batchColor: 0x00ff00 }));
        await flush();

        const colors = textsOf(batch).geometry.getAttribute("color");
        expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 0, 0]);
        expect([colors.getX(3), colors.getY(3), colors.getZ(3)]).toEqual([0, 1, 0]);
    });

    test("coalesces a burst of dirty marks into one rebuild", async () => {
        const { context, update } = createContext();
        const batch = new AnnotationBatch(context, () => {});
        const writer = writerOf();
        batch.register(writer);
        batch.markDirty();
        batch.markDirty();
        await flush();

        expect(update).toHaveBeenCalledTimes(1);
    });

    test("rebuilds when a registered writer changes", async () => {
        const { context } = createContext();
        const batch = new AnnotationBatch(context, () => {});
        const writer = writerOf();
        batch.register(writer);
        await flush();
        const before = Array.from(linePositions(batch));

        writer.buildLineSegments = (target) => target.push(5, 6, 7, 8, 9, 10);
        batch.markDirty();
        await flush();

        expect(Array.from(linePositions(batch))).toEqual([5, 6, 7, 8, 9, 10]);
        expect(Array.from(linePositions(batch))).not.toEqual(before);
    });

    test("prunes itself once the last writer unregisters", async () => {
        const { context } = createContext();
        const onEmpty = rs.fn();
        const parent = new Group();
        const batch = new AnnotationBatch(context, onEmpty);
        parent.add(batch);
        const writer = writerOf();
        batch.register(writer);
        await flush();

        batch.unregister(writer);
        await flush();
        await flush();

        expect(onEmpty).toHaveBeenCalledTimes(1);
        expect(batch.parent).toBeNull();
    });

    test("stays when a writer unregisters but others remain", async () => {
        const { context } = createContext();
        const onEmpty = rs.fn();
        const parent = new Group();
        const batch = new AnnotationBatch(context, onEmpty);
        parent.add(batch);
        const first = writerOf();
        batch.register(first);
        batch.register(writerOf());
        await flush();

        batch.unregister(first);
        await flush();
        await flush();

        expect(onEmpty).not.toHaveBeenCalled();
        expect(batch.parent).toBe(parent);
        expect(linePositions(batch).length).toBe(12);
    });
});
