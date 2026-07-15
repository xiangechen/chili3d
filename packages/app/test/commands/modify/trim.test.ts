// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { EdgeFilter, Trim } from "../../../src/commands/modify/trim";

describe("Trim", () => {
    test("should have command metadata", () => {
        const data = (Trim as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.trim");
        expect(data.icon).toBe("icon-trim");
    });

    test("should extend CancelableCommand", () => {
        const cmd = new Trim();
        // CancelableCommand has executeAsync, controller, etc.
        expect(typeof (cmd as any).executeAsync).toBe("function");
    });
});

describe("EdgeFilter", () => {
    test("should allow shapes with edge type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
    });

    test("should reject shapes with face type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
    });

    test("should reject shapes with wire type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(false);
    });

    test("should reject shapes with solid type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.solid } as any)).toBe(false);
    });

    test("should reject shapes with compound type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.compound } as any)).toBe(false);
    });

    test("should reject shapes with shell type", () => {
        const filter = new EdgeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.shell } as any)).toBe(false);
    });
});
