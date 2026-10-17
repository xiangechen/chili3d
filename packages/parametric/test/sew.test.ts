// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, Result, ShapeTypes } from "@chili3d/core";
import {
    createMockApplication,
    createMockShape,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/features"; // registers all feature handlers
import { type FeatureContext, featureHandler, type SewFeatureData } from "../src/features/feature";

describe("sew feature (mocked kernel)", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    const evaluate = (feature: SewFeatureData, input: IShape) =>
        featureHandler("sew")!.evaluate(feature, {
            document: doc,
            host: { id: "host", worldTransform: () => Matrix4.identity() },
            input,
            scope: doc.variables.evaluate().scope,
        } as FeatureContext);

    const nullShape = () => createMockShape({ isNull: () => true });
    const input = () => createMockShape({ shapeType: ShapeTypes.face });

    test("returns the sewn shape undisposed when every repair step fails", () => {
        const sewn = createMockShape({
            shellSewing: () => nullShape(),
            fixShape: () => nullShape(),
            fixSmallFace: () => nullShape(),
            dispose: rs.fn(),
        });
        setupShapeFactoryMock({ sewing: rs.fn(() => Result.ok(sewn)) });

        const result = evaluate({ id: "s1", type: "sew" }, input());

        // The repair pass aliases the sewn shape here — disposing it would kill the result.
        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(sewn);
        expect(sewn.dispose).not.toHaveBeenCalled();
    });

    test("disposes replaced intermediates and the sewn input, keeping the final repair", () => {
        const finalShape = createMockShape({ dispose: rs.fn() });
        const smallFixed = createMockShape({ fixSmallFace: () => finalShape, dispose: rs.fn() });
        const sewnOnce = createMockShape({ fixShape: () => smallFixed, dispose: rs.fn() });
        const sewn = createMockShape({ shellSewing: () => sewnOnce, dispose: rs.fn() });
        setupShapeFactoryMock({ sewing: rs.fn(() => Result.ok(sewn)) });

        const result = evaluate({ id: "s1", type: "sew" }, input());

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(finalShape);
        expect(sewn.dispose).toHaveBeenCalledTimes(1);
        expect(sewnOnce.dispose).toHaveBeenCalledTimes(1);
        expect(smallFixed.dispose).toHaveBeenCalledTimes(1);
        expect(finalShape.dispose).not.toHaveBeenCalled();
    });

    test("disposes the sewn shape exactly once when only the last repair step succeeds", () => {
        const finalShape = createMockShape({ dispose: rs.fn() });
        const sewn = createMockShape({
            shellSewing: () => nullShape(),
            fixShape: () => nullShape(),
            fixSmallFace: () => finalShape,
            dispose: rs.fn(),
        });
        setupShapeFactoryMock({ sewing: rs.fn(() => Result.ok(sewn)) });

        const result = evaluate({ id: "s1", type: "sew" }, input());

        expect(result.isOk).toBe(true);
        expect(result.unchecked()).toBe(finalShape);
        expect(sewn.dispose).toHaveBeenCalledTimes(1);
        expect(finalShape.dispose).not.toHaveBeenCalled();
    });
});
