// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import {
    ConvertToFace,
    ConvertToShell,
    ConvertToSolid,
    ConvertToWire,
} from "../../../src/commands/create/converter";

describe("ConvertToWire", () => {
    test("should have command metadata", () => {
        const data = (ConvertToWire as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("convert.toWire");
        expect(data.icon).toBe("icon-toPoly");
    });

    test("shapeFilter should allow edges", () => {
        const cmd = new ConvertToWire();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
    });

    test("shapeFilter should allow wires", () => {
        const cmd = new ConvertToWire();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(true);
    });

    test("shapeFilter should reject faces", () => {
        const cmd = new ConvertToWire();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
    });
});

describe("ConvertToFace", () => {
    test("should have command metadata", () => {
        const data = (ConvertToFace as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("convert.toFace");
        expect(data.icon).toBe("icon-toFace");
    });

    test("shapeFilter should allow edges and wires", () => {
        const cmd = new ConvertToFace();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(true);
    });
});

describe("ConvertToShell", () => {
    test("should have command metadata", () => {
        const data = (ConvertToShell as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("convert.toShell");
        expect(data.icon).toBe("icon-toShell");
    });

    test("shapeFilter should allow only faces", () => {
        const cmd = new ConvertToShell();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(false);
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(false);
    });
});

describe("ConvertToSolid", () => {
    test("should have command metadata", () => {
        const data = (ConvertToSolid as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("convert.toSolid");
        expect(data.icon).toBe("icon-toSolid");
    });

    test("shapeFilter should allow only shells", () => {
        const cmd = new ConvertToSolid();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.shell } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(false);
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(false);
    });
});
