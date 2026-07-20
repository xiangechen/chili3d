// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { ShapeTypes } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { PipeNode } from "../../src/bodys/pipe";
import { createMockDocument } from "../_helpers";
import { createMockWireWithEdgeLoop } from "./_utils";

describe("PipeNode advanced", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("resolveBendRadius", () => {
        test("should return isNative=true when bendRadius is -1", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, bendRadius: -1 });
            const result = (node as any).resolveBendRadius();
            expect(result.isNative).toBe(true);
        });

        test("should return isNative=false when bendRadius is 0 (default)", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.bendRadius).toBe(0);
            const result = (node as any).resolveBendRadius();
            expect(result.isNative).toBe(false);
        });

        test("should clamp bendRadius when it is less than radius + precision", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 10, path, bendRadius: 3 });
            const result = (node as any).resolveBendRadius();
            // bendRadius=3 < radius(10) + 1.0 = 11 → clamp to radius+1.0
            expect(result.bendR).toBe(11);
        });

        test("should not clamp bendRadius when it is >= radius + precision", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, bendRadius: 20 });
            const result = (node as any).resolveBendRadius();
            expect(result.bendR).toBe(20);
        });
    });

    describe("createFilletedPath", () => {
        test("should return original path when bendRadius is 0", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = (node as any).createFilletedPath(path, 0);
            expect(result).toBe(path);
        });

        test("should return original path when bendRadius is negative", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = (node as any).createFilletedPath(path, -1);
            expect(result).toBe(path);
        });

        test("should return original path when it has fewer than 2 edges", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            const result = (node as any).createFilletedPath(path, 5);
            expect(result).toBe(path);
        });
    });

    describe("ensureWire", () => {
        test("should return the same wire shape when given a wire", () => {
            const wirePath: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path: wirePath });
            const result = (node as any).ensureWire(wirePath);
            expect(result.shapeType).toBe(ShapeTypes.wire);
        });
    });
});
