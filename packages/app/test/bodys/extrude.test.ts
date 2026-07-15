// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { ExtrudeNode } from "../../src/bodys/extrude";
import { createMockDocument } from "../_helpers";
import { createMockShape, createMockWire, setupShapeFactoryMock } from "./_utils";

describe("ExtrudeNode", () => {
    let doc: IDocument;
    let section: any;

    beforeEach(() => {
        doc = createMockDocument();
        section = createMockWire();
    });

    describe("constructor", () => {
        test("should initialize section and length", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 50 });
            expect(node.section).toBe(section);
            expect(node.length).toBe(50);
        });

        test("should set name from display()", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            expect(node.name).toBe("body.extrude");
        });
    });

    describe("display", () => {
        test("should return body.extrude", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            expect(node.display()).toBe("body.extrude");
        });
    });

    describe("getters", () => {
        test("should return section and length", () => {
            const node = new ExtrudeNode({ document: doc, section, length: 42 });
            expect(node.section).toBe(section);
            expect(node.length).toBe(42);
        });
    });

    describe("setters", () => {
        test("setting section should update value", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const newSection = createMockWire();
            node.section = newSection as any;
            expect(node.section).toBe(newSection);
        });

        test("setting length should update value", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            node.length = 99;
            expect(node.length).toBe(99);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on length change", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.length = 77;
            expect(events).toContain("length");
        });

        test("should emit on section change", () => {
            setupShapeFactoryMock({ prism: () => Result.ok(createMockShape() as any) });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.section = createMockWire() as any;
            expect(events).toContain("section");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.prism for non-face wire section", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                prism: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape() as any);
                },
            });
            const node = new ExtrudeNode({ document: doc, section, length: 10 });
            node.generateShape();
            expect(calledWith.length).toBe(2);
            expect(calledWith[0]).toBe(section);
        });
    });
});
