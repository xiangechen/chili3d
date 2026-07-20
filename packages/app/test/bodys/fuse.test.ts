// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { FuseNode } from "../../src/bodys/fuse";
import { createMockDocument } from "../_helpers";
import { createMockShape } from "./_utils";

describe("FuseNode", () => {
    let doc: IDocument;
    let bottom: any;
    let top: any;

    beforeEach(() => {
        doc = createMockDocument();
        bottom = createMockShape();
        top = createMockShape();
    });

    describe("constructor", () => {
        test("should initialize bottom and top", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            expect(node.bottom).toBe(bottom);
            expect(node.top).toBe(top);
        });

        test("should set name from display()", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            expect(node.name).toBe("body.fuse");
        });
    });

    describe("display", () => {
        test("should return body.fuse", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            expect(node.display()).toBe("body.fuse");
        });
    });

    describe("getters", () => {
        test("should return bottom and top", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            expect(node.bottom).toBe(bottom);
            expect(node.top).toBe(top);
        });
    });

    describe("setters", () => {
        test("setting bottom should update value before generateShape throws", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            const newBottom = createMockShape();
            try {
                node.bottom = newBottom as any;
            } catch (_e) {
                // generateShape throws, but setProperty already stored the value
            }
            expect(node.bottom).toBe(newBottom);
        });

        test("setting top should update value before generateShape throws", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            const newTop = createMockShape();
            try {
                node.top = newTop as any;
            } catch (_e) {
                // generateShape throws, but setProperty already stored the value
            }
            expect(node.top).toBe(newTop);
        });
    });

    describe("onPropertyChanged", () => {
        test("should emit on bottom change before generateShape throws", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            try {
                node.bottom = createMockShape() as any;
            } catch (_e) {
                // expected
            }
            expect(events).toContain("bottom");
        });

        test("should emit on top change before generateShape throws", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            const events: string[] = [];
            node.onPropertyChanged((prop: string) => events.push(prop));
            try {
                node.top = createMockShape() as any;
            } catch (_e) {
                // expected
            }
            expect(events).toContain("top");
        });
    });

    describe("generateShape", () => {
        test("should throw Method not implemented", () => {
            const node = new FuseNode({ document: doc, bottom, top });
            expect(() => node.generateShape()).toThrow("Method not implemented.");
        });
    });
});
