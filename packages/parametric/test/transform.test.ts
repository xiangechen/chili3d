// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockShape, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/features"; // registers all feature handlers
import {
    type FeatureContext,
    featureHandler,
    type ShapeTracking,
    type TransformFeatureData,
} from "../src/features/feature";

describe("transform feature (mocked kernel)", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    const evaluate = (feature: TransformFeatureData, input: IShape, tracking?: ShapeTracking) =>
        featureHandler("transform")!.evaluate(feature, {
            document: doc,
            host: { id: "host", worldTransform: () => Matrix4.identity() },
            input,
            scope: doc.variables.evaluate().scope,
            tracking,
        } as FeatureContext);

    test("applies the matrix and carries the sub-shape ids across positionally", () => {
        const output = createMockShape({ shapeType: ShapeTypes.solid });
        const transformedMul = rs.fn((_matrix: Matrix4) => output);
        const shape = createMockShape({ transformedMul });
        const tracking: ShapeTracking = {
            inputFaceIds: ["f1", "f2"],
            inputEdgeIds: ["e1"],
            outputFaceIds: [],
            outputEdgeIds: [],
        };
        const matrix = Matrix4.fromTranslation(10, 20, 30);

        const result = evaluate({ id: "t1", type: "transform", matrix: matrix.toArray() }, shape, tracking);

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(output);
        expect(transformedMul).toHaveBeenCalledTimes(1);
        expect((transformedMul.mock.calls[0][0] as Matrix4).equals(matrix)).toBe(true);
        expect(tracking.outputFaceIds).toEqual(["f1", "f2"]);
        expect(tracking.outputEdgeIds).toEqual(["e1"]);
    });

    test("returns the input untouched for an identity matrix", () => {
        const transformedMul = rs.fn();
        const shape = createMockShape({ transformedMul });

        const result = evaluate({ id: "t1", type: "transform", matrix: Matrix4.identity().toArray() }, shape);

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(shape);
        expect(transformedMul).not.toHaveBeenCalled();
    });

    test("rejects a non-rigid matrix instead of letting gp_Trsf orthogonalize it", () => {
        const shape = createMockShape({ transformedMul: rs.fn() });

        const result = evaluate(
            { id: "t1", type: "transform", matrix: Matrix4.fromScale(2, 1, 1).toArray() },
            shape,
        );

        expect(result.isOk).toBe(false);
    });

    test("accepts a mirror", () => {
        const output = createMockShape({ shapeType: ShapeTypes.solid });
        const shape = createMockShape({ transformedMul: rs.fn(() => output) });

        const result = evaluate(
            { id: "t1", type: "transform", matrix: Matrix4.fromScale(-1, 1, 1).toArray() },
            shape,
        );

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(output);
    });

    test("exposes translation in mm and rotation in degrees", () => {
        const feature: TransformFeatureData = {
            id: "t1",
            type: "transform",
            matrix: Matrix4.fromTranslation(10, 20, 30).toArray(),
        };

        const parameters = featureHandler("transform")!.parameters(feature);

        expect(parameters.map((x) => x.key)).toEqual(["tx", "ty", "tz", "rx", "ry", "rz"]);
        [10, 20, 30, 0, 0, 0].forEach((expected, index) => {
            expect(parameters[index].value as number).toBeCloseTo(expected, 9);
        });
    });

    test("patches a translation without disturbing the rotation", () => {
        const rotated = Matrix4.fromAxisRad({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
        const handler = featureHandler("transform")!;
        const feature: TransformFeatureData = {
            id: "t1",
            type: "transform",
            matrix: rotated.toArray(),
        };

        const next = handler.setParameter(feature, "tx", 25) as TransformFeatureData;
        const array = next.matrix;

        expect(array[12]).toBe(25);
        expect(array.slice(0, 12)).toEqual(rotated.toArray().slice(0, 12));
    });

    test("edits a rotation angle in degrees and round-trips through the matrix", () => {
        const handler = featureHandler("transform")!;
        const feature: TransformFeatureData = {
            id: "t1",
            type: "transform",
            matrix: Matrix4.fromTranslation(5, 0, 0).toArray(),
        };

        const next = handler.setParameter(feature, "rz", 90) as TransformFeatureData;
        // Row-vector convention: rotate first, then translate — the offset is preserved.
        const expected = Matrix4.fromAxisRad(
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            Math.PI / 2,
        ).multiply(Matrix4.fromTranslation(5, 0, 0));

        next.matrix.forEach((value, index) => {
            expect(value).toBeCloseTo(expected.toArray()[index], 9);
        });
    });

    test("a mirror only exposes translation parameters", () => {
        const feature: TransformFeatureData = {
            id: "t1",
            type: "transform",
            matrix: Matrix4.fromScale(-1, 1, 1).toArray(),
        };

        const keys = featureHandler("transform")!
            .parameters(feature)
            .map((x) => x.key);

        expect(keys).toEqual(["tx", "ty", "tz"]);
    });
});
