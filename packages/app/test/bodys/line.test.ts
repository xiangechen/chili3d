// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { LineNode } from "../../src/bodys/line";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("LineNode", () => {
    let doc: IDocument;
    const start = XYZ.zero;
    const end = new XYZ({ x: 10, y: 10, z: 10 });

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize start and end", () => {
            const node = new LineNode({ document: doc, start, end });
            expect(node.start).toBe(start);
            expect(node.end).toBe(end);
        });

        test("should set name from display()", () => {
            const node = new LineNode({ document: doc, start, end });
            expect(node.name).toBe("body.line");
        });
    });

    describe("display", () => {
        test("should return body.line", () => {
            const node = new LineNode({ document: doc, start, end });
            expect(node.display()).toBe("body.line");
        });
    });

    describe("getters", () => {
        test("should return start and end", () => {
            const s = new XYZ({ x: 1, y: 2, z: 3 });
            const e = new XYZ({ x: 4, y: 5, z: 6 });
            const node = new LineNode({ document: doc, start: s, end: e });
            expect(node.start).toBe(s);
            expect(node.end).toBe(e);
        });
    });

    describe("setters", () => {
        test("setting start should update value", () => {
            setupShapeFactoryMock({ line: () => Result.ok(createMockShape()) });
            const node = new LineNode({ document: doc, start, end });
            const ns = new XYZ({ x: 1, y: 1, z: 1 });
            node.start = ns;
            expect(node.start).toBe(ns);
        });

        test("setting end should update value", () => {
            setupShapeFactoryMock({ line: () => Result.ok(createMockShape()) });
            const node = new LineNode({ document: doc, start, end });
            const ne = new XYZ({ x: 99, y: 99, z: 99 });
            node.end = ne;
            expect(node.end).toBe(ne);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on start change", () => {
            setupShapeFactoryMock({ line: () => Result.ok(createMockShape()) });
            const node = new LineNode({ document: doc, start, end });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.start = new XYZ({ x: 5, y: 5, z: 5 });
            expect(events).toContain("start");
        });

        test("should emit on end change", () => {
            setupShapeFactoryMock({ line: () => Result.ok(createMockShape()) });
            const node = new LineNode({ document: doc, start, end });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.end = new XYZ({ x: 7, y: 7, z: 7 });
            expect(events).toContain("end");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.line", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                line: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new LineNode({ document: doc, start, end });
            node.generateShape();
            expect(calledWith[0]).toBe(start);
            expect(calledWith[1]).toBe(end);
        });
    });
});
