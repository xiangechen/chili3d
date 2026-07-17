// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Matrix4, type ShapeNode, ShapeTypes, type VisualNode } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { WireNode } from "../../../src/bodys/wire";
import {
    ConvertToFace,
    ConvertToShell,
    ConvertToSolid,
    ConvertToWire,
} from "../../../src/commands/create/converter";
import { ensureGlobalStubApp, mockShape, stubTransactionRun, wireCommand } from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

function stubDocumentSelection(doc: IDocument, nodes: VisualNode[]) {
    (doc.selection as any).getSelectedNodes = () => nodes;
}

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

    test("create should return a Result for a shape node", () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({
                shapeType: ShapeTypes.edge,
                transformedMul: () => mockShape({ shapeType: ShapeTypes.edge }) as any,
            });
            const node = {
                shape: { value: shape },
                worldTransform: () => Matrix4.identity(),
            } as unknown as ShapeNode;
            const result = (cmd as any).create(doc, [node]);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeInstanceOf(WireNode);
        } finally {
            restoreTx();
        }
    });

    describe("_getSelectedModels", () => {
        test("should return nodes matching the shape filter", () => {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.edge });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const models = (cmd as any)._getSelectedModels(doc, (cmd as any).shapeFilter());
            expect(models).toHaveLength(1);
        });

        test("should filter out nodes with no shape", () => {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const node = { shape: { value: undefined } };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const models = (cmd as any)._getSelectedModels(doc, (cmd as any).shapeFilter());
            expect(models).toHaveLength(0);
        });

        test("should filter out nodes not matching the shape filter", () => {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.face });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const models = (cmd as any)._getSelectedModels(doc, (cmd as any).shapeFilter());
            expect(models).toHaveLength(0);
        });
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

    describe("_getSelectedModels", () => {
        test("should filter by shell shape type", () => {
            const cmd = new ConvertToSolid();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.shell });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const filter = (cmd as any).shapeFilter();
            const models = (cmd as any)._getSelectedModels(doc, filter);
            expect(models).toHaveLength(1);
        });

        test("should reject non-shell shapes", () => {
            const cmd = new ConvertToSolid();
            const { doc } = wireCommand(cmd);
            const shape = mockShape({ shapeType: ShapeTypes.face });
            const node = {
                shape: { value: shape },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const filter = (cmd as any).shapeFilter();
            const models = (cmd as any)._getSelectedModels(doc, filter);
            expect(models).toHaveLength(0);
        });
    });
});
