// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { Result, XYZ } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { PointNode } from "../../src/bodys/point";
import { createMockDocument } from "../_helpers";
import { createMockShape, setupShapeFactoryMock } from "./_utils";

describe("PointNode", () => {
    let doc: IDocument;
    const position = new XYZ({ x: 5, y: 10, z: 15 });

    beforeEach(() => {
        doc = createMockDocument();
    });

    describe("constructor", () => {
        test("should initialize position", () => {
            const node = new PointNode({ document: doc, position });
            expect(node.position).toBe(position);
        });

        test("should set name from display()", () => {
            const node = new PointNode({ document: doc, position });
            expect(node.name).toBe("body.point");
        });
    });

    describe("display", () => {
        test("should return body.point", () => {
            const node = new PointNode({ document: doc, position });
            expect(node.display()).toBe("body.point");
        });
    });

    describe("getters", () => {
        test("should return position", () => {
            const node = new PointNode({ document: doc, position });
            expect(node.position).toBe(position);
        });
    });

    describe("setters", () => {
        test("setting position should update value", () => {
            setupShapeFactoryMock({ point: () => Result.ok(createMockShape()) });
            const node = new PointNode({ document: doc, position });
            const np = new XYZ({ x: 99, y: 99, z: 99 });
            node.position = np;
            expect(node.position).toBe(np);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on position change", () => {
            setupShapeFactoryMock({ point: () => Result.ok(createMockShape()) });
            const node = new PointNode({ document: doc, position });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            node.position = new XYZ({ x: 1, y: 1, z: 1 });
            expect(events).toContain("position");
        });
    });

    describe("generateShape", () => {
        test("should call shapeFactory.point", () => {
            let calledWith: any[] = [];
            setupShapeFactoryMock({
                point: (...args: any[]) => {
                    calledWith = args;
                    return Result.ok(createMockShape());
                },
            });
            const node = new PointNode({ document: doc, position });
            node.generateShape();
            expect(calledWith[0]).toBe(position);
        });

        test("should return Result.err when shapeFactory.point fails", () => {
            setupShapeFactoryMock({
                point: () => Result.err("point creation failed"),
            });
            const node = new PointNode({ document: doc, position });
            const result = node.generateShape();
            expect(result.isOk).toBe(false);
        });
    });
});
