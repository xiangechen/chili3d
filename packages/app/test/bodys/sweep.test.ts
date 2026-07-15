// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, ShapeTypes } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { SweepedNode } from "../../src/bodys/sweep";
import { createMockDocument } from "../_helpers";
import { createMockWire, setupShapeFactoryMock } from "./_utils";

describe("SweepedNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize profile, path, and round when path is already a wire", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({ wire: () => Result.ok(wire as any) });

            const pathWire: any = wire;
            const profileEdge: any = { ...wire, shapeType: ShapeTypes.edge };
            const node = new SweepedNode({
                document: doc,
                profile: [profileEdge],
                path: pathWire,
                round: true,
            });
            expect(node.profile.length).toBe(1);
            expect(node.path.shapeType).toBe(ShapeTypes.wire);
            expect(node.round).toBe(true);
        });

        test("should set name from display()", () => {
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            expect(node.name).toBe("body.sweep");
        });

        test("should default round to false", () => {
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            expect(node.round).toBe(false);
        });
    });

    describe("display", () => {
        test("should return body.sweep", () => {
            const w: any = createMockWire();
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: false });
            expect(node.display()).toBe("body.sweep");
        });
    });

    describe("getters", () => {
        test("should return profile, path, round", () => {
            const wire = createMockWire();
            setupShapeFactoryMock({ wire: () => Result.ok(wire as any) });
            const w: any = wire;
            const node = new SweepedNode({ document: doc, profile: [w], path: w, round: true });
            expect(node.round).toBe(true);
            expect(node.path).toBe(w);
        });
    });
});
