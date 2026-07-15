// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { PipeNode } from "../../src/bodys/pipe";
import { createMockDocument } from "../_helpers";
import { createMockWireWithEdgeLoop, setupShapeFactoryMock } from "./_utils";

describe("PipeNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize radius, path, bendRadius, thickness", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.radius).toBe(5);
            expect(node.path).toBe(path);
            expect(node.bendRadius).toBe(0);
            expect(node.thickness).toBe(0);
        });

        test("should set optional bendRadius and thickness", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path, bendRadius: 10, thickness: 2 });
            expect(node.bendRadius).toBe(10);
            expect(node.thickness).toBe(2);
        });

        test("should set name from display()", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.name).toBe("body.pipe");
        });
    });

    describe("display", () => {
        test("should return body.pipe", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.display()).toBe("body.pipe");
        });
    });

    describe("getters", () => {
        test("should return constructor values", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 8, path });
            expect(node.radius).toBe(8);
            expect(node.path).toBe(path);
        });

        test("bendRadius default should be 0", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.bendRadius).toBe(0);
        });

        test("thickness default should be 0", () => {
            const path: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path });
            expect(node.thickness).toBe(0);
        });
    });

    describe("generateShape error paths", () => {
        test("should return error when path has no edges", () => {
            const wireWithEdges: any = createMockWireWithEdgeLoop();
            const node = new PipeNode({ document: doc, radius: 5, path: wireWithEdges });
            wireWithEdges.edgeLoop = () => [];
            setupShapeFactoryMock({});
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
