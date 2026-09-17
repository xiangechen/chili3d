// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result } from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeEach, describe, expect, rs, test } from "@rstest/core";
import { WireNode } from "../../src/bodys/wire";
import { createMockEdge, createMockWire, setupShapeFactoryMock } from "./_utils";

describe("WireNode", () => {
    let doc: IDocument;

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize edges", () => {
            const edges: any = [createMockEdge(), createMockEdge()];
            const node = new WireNode({ document: doc, edges });
            expect(node.edges).toBe(edges);
        });

        test("should set name from display()", () => {
            const node = new WireNode({ document: doc, edges: [createMockEdge() as any] });
            expect(node.name).toBe("body.wire1");
        });
    });

    describe("display", () => {
        test("should return body.wire", () => {
            const node = new WireNode({ document: doc, edges: [createMockEdge() as any] });
            expect(node.display()).toBe("body.wire");
        });
    });

    describe("getters", () => {
        test("should return edges", () => {
            const edges: any = [createMockEdge()];
            const node = new WireNode({ document: doc, edges });
            expect(node.edges).toBe(edges);
        });
    });

    describe("setters", () => {
        test("setting edges should update value", () => {
            setupShapeFactoryMock({ wire: () => Result.ok(createMockWire() as any) });
            const node = new WireNode({ document: doc, edges: [createMockEdge() as any] });
            const ne: any = [createMockEdge(), createMockEdge()];
            node.edges = ne;
            expect(node.edges).toBe(ne);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on edges change", () => {
            setupShapeFactoryMock({ wire: () => Result.ok(createMockWire() as any) });
            const node = new WireNode({ document: doc, edges: [createMockEdge() as any] });
            const handler = rs.fn((_property: string) => {});
            node.onPropertyChanged(handler);
            node.edges = [createMockEdge() as any];
            expect(handler.mock.calls.map((c) => c[0])).toContain("edges");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.wire with edges", () => {
            const wire = rs.fn(() => Result.ok(createMockWire() as any));
            setupShapeFactoryMock({ wire });
            const edges: any = [createMockEdge()];
            const node = new WireNode({ document: doc, edges });
            node.generateShape();
            expect(wire).toHaveBeenCalledWith(edges);
        });

        test("should return Result.err when shapeFactory.wire fails", () => {
            setupShapeFactoryMock({
                wire: () => Result.err("wire creation failed"),
            });
            const edges: any = [createMockEdge()];
            const node = new WireNode({ document: doc, edges });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
