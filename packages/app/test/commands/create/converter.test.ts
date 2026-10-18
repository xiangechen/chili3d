// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Matrix4, PubSub, type ShapeNode, ShapeTypes, type VisualNode } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, rs, test } from "@rstest/core";
import { WireNode } from "../../../src/bodys/wire";
import {
    ConvertToCompound,
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
        expect(data).not.toBeNull();
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
        expect(data).not.toBeNull();
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
        expect(data).not.toBeNull();
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
        expect(data).not.toBeNull();
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

describe("ConvertToCompound", () => {
    test("should have command metadata", () => {
        const data = (ConvertToCompound as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("convert.toCompound");
        expect(data.icon).toBe("icon-compound");
    });

    test("shapeFilter should allow any shape type", () => {
        const cmd = new ConvertToCompound();
        const filter = (cmd as any).shapeFilter();
        expect(filter.allow({ shapeType: ShapeTypes.edge } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.wire } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.face } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.shell } as any)).toBe(true);
        expect(filter.allow({ shapeType: ShapeTypes.solid } as any)).toBe(true);
    });

    describe("_getSelectedModels", () => {
        test("should keep nodes of any shape type", () => {
            const cmd = new ConvertToCompound();
            const { doc } = wireCommand(cmd);
            const node = {
                shape: { value: mockShape({ shapeType: ShapeTypes.solid }) },
                transform: Matrix4.identity(),
            };
            stubDocumentSelection(doc, [node as unknown as VisualNode]);
            const filter = (cmd as any).shapeFilter();
            const models = (cmd as any)._getSelectedModels(doc, filter);
            expect(models).toHaveLength(1);
        });
    });
});

describe("ConvertCommand instance sources", () => {
    function edgeNode(id: string) {
        const shape = mockShape({
            shapeType: ShapeTypes.edge,
            transformedMul: () => mockShape({ shapeType: ShapeTypes.edge }) as any,
        });
        return {
            id,
            name: id,
            shape: { value: shape },
            transform: Matrix4.identity(),
            worldTransform: () => Matrix4.identity(),
            parent: { remove: rs.fn() },
        };
    }

    test("retargets an instance when a single node is converted", async () => {
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const source = edgeNode("source");
            stubDocumentSelection(doc, [source as unknown as VisualNode]);
            const instance = { id: "instance", isInstance: true, sourceId: "source" };
            (doc.modelManager as any).findNodesDeep = () => [instance];

            await cmd.executeAsync();

            const root = doc.modelManager.rootNode as any;
            expect(root.added).toHaveLength(1);
            expect(instance.sourceId).toBe(root.added[0].id);
            expect(source.parent.remove).toHaveBeenCalledWith(source);
        } finally {
            restoreTx();
        }
    });

    test("refuses to merge several nodes when an instance reads one", async () => {
        const restoreTx = stubTransactionRun();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const cmd = new ConvertToWire();
            const { doc } = wireCommand(cmd);
            const first = edgeNode("source");
            const second = edgeNode("other");
            stubDocumentSelection(doc, [first as unknown as VisualNode, second as unknown as VisualNode]);
            (doc.modelManager as any).findNodesDeep = () => [
                { id: "instance", isInstance: true, sourceId: "source" },
            ];

            await cmd.executeAsync();

            expect(pub).toHaveBeenCalledWith("showToast", "toast.instance.sourceInUse");
            expect((doc.modelManager.rootNode as any).added).toHaveLength(0);
            expect(first.parent.remove).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            restoreTx();
        }
    });
});
