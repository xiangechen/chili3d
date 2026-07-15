// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { WireNode } from "../../src/bodys/wire";
import { createMockDocument } from "../_helpers";
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
            expect(node.name).toBe("body.wire");
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
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.edges = [createMockEdge() as any];
            expect(events).toContain("edges");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.wire with edges", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                wire: (edges: any[]) => {
                    calledWith = edges;
                    return Result.ok(createMockWire() as any);
                },
            });
            const edges: any = [createMockEdge()];
            const node = new WireNode({ document: doc, edges });
            node.generateShape();
            expect(calledWith).toEqual(edges);
        });
    });
});
