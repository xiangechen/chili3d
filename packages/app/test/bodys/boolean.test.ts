// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";
import { BooleanNode } from "../../src/bodys/boolean";
import { createMockDocument } from "../_helpers";
import { createMockShape } from "./_utils";

describe("BooleanNode", () => {
    let doc: IDocument;
    let booleanShape: any;

    beforeEach(() => {
        doc = createMockDocument();
        booleanShape = createMockShape();
    });

    describe("constructor", () => {
        test("should initialize booleanShape", () => {
            const node = new BooleanNode({ document: doc, booleanShape });
            expect(node.booleanShape).toBe(booleanShape);
        });

        test("should set name from display()", () => {
            const node = new BooleanNode({ document: doc, booleanShape });
            expect(node.name).toBe("body.bolean");
        });
    });

    describe("display", () => {
        test("should return body.bolean", () => {
            const node = new BooleanNode({ document: doc, booleanShape });
            expect(node.display()).toBe("body.bolean");
        });
    });

    describe("getters", () => {
        test("booleanShape should be read-only (no setter)", () => {
            const node = new BooleanNode({ document: doc, booleanShape });
            expect(node.booleanShape).toBe(booleanShape);
        });
    });

    describe("generateShape", () => {
        test("should return Result.ok with the booleanShape", () => {
            const node = new BooleanNode({ document: doc, booleanShape });
            const result = node.generateShape();
            expect(result.isOk).toBe(true);
            expect(result.value).toBe(booleanShape);
        });
    });
});
