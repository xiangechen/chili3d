// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IVisual, IVisualObject, Matrix4, ShapeMeshData, VisualNode } from "@chili3d/core";
import { ShapeTypes, VisualStates } from "@chili3d/core";
import { Group, Mesh, MeshBasicMaterial, Object3D, Scene, SphereGeometry } from "three";
import { ThreeVisualContext } from "../src/threeVisualContext";
import { createMockVisualContext, createTestGeometryNode } from "./mocks";

// ============================================================================
// Mock-based tests — verify the mocked wrapper itself
// ============================================================================

describe("ThreeVisualContext (mocked)", () => {
    let context: ThreeVisualContext;
    let scene: Scene;

    beforeEach(() => {
        context = createMockVisualContext();
        scene = context.scene;
    });

    test("scene exists", () => {
        expect(scene).toBeInstanceOf(Scene);
    });

    test("visualShapes is a child of scene", () => {
        expect(scene.children).toContain(context.visualShapes);
    });

    test("visualShapes is a Group", () => {
        expect(context.visualShapes).toBeInstanceOf(Group);
    });

    test("tempShapes is a Group", () => {
        expect(context.tempShapes).toBeInstanceOf(Group);
    });

    test("cssObjects is a Group", () => {
        expect(context.cssObjects).toBeInstanceOf(Group);
    });

    test("materialMap is a Map", () => {
        expect(context.materialMap).toBeInstanceOf(Map);
    });

    test("getVisual returns undefined when no visualMap provided", () => {
        const node = {} as VisualNode;
        expect(context.getVisual(node)).toBeUndefined();
    });

    test("getVisual returns mapped mesh when visualMap provided", () => {
        const node = {} as VisualNode;
        const mesh = new Mesh(new SphereGeometry(1, 4, 4));
        const ctx2 = createMockVisualContext(new Map([[node, mesh]]));
        const result = ctx2.getVisual(node);
        expect(result).toBe(mesh);
    });

    test("getMaterial returns a MeshBasicMaterial", () => {
        const mat = context.getMaterial("test");
        expect(mat).toBeInstanceOf(MeshBasicMaterial);
    });

    test("visuals returns empty array", () => {
        expect(context.visuals()).toEqual([]);
    });

    test("boundingBoxIntersectFilter returns empty array", () => {
        expect(context.boundingBoxIntersectFilter({ min: { x: 0 }, max: { x: 1 } } as any)).toEqual([]);
    });

    test("displayMesh returns 0 (no-op)", () => {
        expect(context.displayMesh([] as unknown as ShapeMeshData[])).toBe(0);
    });

    test("displayInstancedMesh returns 0 (no-op)", () => {
        const meshData = {
            position: new Float32Array(),
            index: new Uint32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        expect(context.displayInstancedMesh(meshData, [] as unknown as Matrix4[])).toBe(0);
    });

    test("displayLineSegments returns 0 (no-op)", () => {
        expect(
            context.displayLineSegments({
                lineType: "solid",
                position: new Float32Array(),
                range: [],
            } as any),
        ).toBe(0);
    });

    test("findShapes returns empty array", () => {
        expect(context.findShapes(ShapeTypes.edge)).toEqual([]);
    });

    test("getNode returns undefined", () => {
        expect(context.getNode({} as any)).toBeUndefined();
    });

    test("shapeCount is 0 by default", () => {
        const context = createMockVisualContext();
        expect(context.shapeCount).toBe(0);
    });

    describe("non-throwing methods", () => {
        let context: ThreeVisualContext;

        beforeEach(() => {
            context = createMockVisualContext();
        });

        test("addNode does not throw", () => {
            expect(() => context.addNode([])).not.toThrow();
        });

        test("removeNode does not throw", () => {
            expect(() => context.removeNode([])).not.toThrow();
        });

        test("dispose does not throw", () => {
            expect(() => context.dispose()).not.toThrow();
        });

        test("redrawNode does not throw", () => {
            expect(() => context.redrawNode({} as any)).not.toThrow();
        });

        test("setMeshColor does not throw", () => {
            expect(() => context.setMeshColor(1, 0xff0000)).not.toThrow();
        });

        test("setPosition does not throw", () => {
            expect(() => context.setPosition(1, new Float32Array([0, 0, 0]) as any)).not.toThrow();
        });

        test("setInstanceMatrix does not throw", () => {
            expect(() => context.setInstanceMatrix(1, [] as unknown as Matrix4[])).not.toThrow();
        });

        test("removeMesh does not throw", () => {
            expect(() => context.removeMesh(1)).not.toThrow();
        });

        test("setVisible does not throw", () => {
            expect(() => context.setVisible({} as any, true)).not.toThrow();
        });

        test("moveNode does not throw", () => {
            expect(() => context.moveNode({} as any, null as any)).not.toThrow();
        });

        test("addVisualObject does not throw", () => {
            expect(() => context.addVisualObject({} as any)).not.toThrow();
        });

        test("removeVisualObject does not throw", () => {
            expect(() => context.removeVisualObject({} as any)).not.toThrow();
        });

        test("handleNodeChanged does not throw", () => {
            expect(() => context.handleNodeChanged([])).not.toThrow();
        });
    });
});

// ============================================================================
// Real instance tests — verify actual ThreeVisualContext behaviour
// ============================================================================

/**
 * Creates a minimal visual mock that ThreeVisualContext constructor can work with.
 */
function createMockVisual(): IVisual {
    const nodeObservers: Array<(records: unknown[]) => void> = [];
    const collectionHandlers: Array<(args: unknown) => void> = [];

    return {
        document: {
            modelManager: {
                rootNode: { firstChild: null },
                addNodeObserver: (fn: (records: unknown[]) => void) => {
                    nodeObservers.push(fn);
                },
                removeNodeObserver: (fn: (records: unknown[]) => void) => {
                    const idx = nodeObservers.indexOf(fn);
                    if (idx >= 0) nodeObservers.splice(idx, 1);
                },
                materials: {
                    forEach: () => {},
                    removeCollectionChanged: () => {},
                    onCollectionChanged: (fn: (args: unknown) => void) => {
                        collectionHandlers.push(fn);
                    },
                },
                _nodeObservers: nodeObservers,
                _collectionHandlers: collectionHandlers,
            },
            selection: {
                onNodeChanged: { sub: () => {}, remove: () => {} },
            },
        },
    } as unknown as IVisual;
}

describe("ThreeVisualContext (real instance)", () => {
    let context: ThreeVisualContext;
    let scene: Scene;
    let visual: IVisual;

    beforeEach(() => {
        visual = createMockVisual();
        scene = new Scene();
        context = new ThreeVisualContext(visual, scene);
    });

    describe("constructor", () => {
        test("should create visualShapes, tempShapes, cssObjects groups", () => {
            expect(context.visualShapes).toBeInstanceOf(Group);
            expect(context.tempShapes).toBeInstanceOf(Group);
            expect(context.cssObjects).toBeInstanceOf(Group);
            expect(context.materialMap).toBeInstanceOf(Map);
        });

        test("should add groups to scene", () => {
            expect(scene.children).toContain(context.visualShapes);
            expect(scene.children).toContain(context.tempShapes);
            expect(scene.children).toContain(context.cssObjects);
        });

        test("should register node observer on model manager", () => {
            const observers = (visual.document.modelManager as any)._nodeObservers;
            expect(observers.length).toBeGreaterThan(0);
        });
    });

    describe("addVisualObject / removeVisualObject", () => {
        test("should add Object3D to visualShapes", () => {
            const obj = new Object3D();
            context.addVisualObject(obj as unknown as IVisualObject);
            expect(context.visualShapes.children).toContain(obj);
            expect(context.shapeCount).toBe(1);
        });

        test("should remove Object3D from visualShapes", () => {
            const obj = new Object3D();
            context.addVisualObject(obj as unknown as IVisualObject);
            expect(context.shapeCount).toBe(1);

            context.removeVisualObject(obj as unknown as IVisualObject);
            expect(context.visualShapes.children).not.toContain(obj);
            expect(context.shapeCount).toBe(0);
        });

        test("should ignore non-Object3D in addVisualObject", () => {
            const noop = {} as IVisualObject;
            context.addVisualObject(noop);
            expect(context.shapeCount).toBe(0);
        });

        test("should ignore non-Object3D in removeVisualObject", () => {
            const noop = {} as IVisualObject;
            context.addVisualObject(new Object3D() as unknown as IVisualObject);
            context.removeVisualObject(noop);
            expect(context.shapeCount).toBe(1);
        });
    });

    describe("getNode / getVisual", () => {
        test("getNode should return undefined for unknown visual", () => {
            const obj = {} as IVisualObject;
            expect(context.getNode(obj)).toBeUndefined();
        });

        test("getVisual should return undefined for unknown node", () => {
            const node = {} as VisualNode;
            expect(context.getVisual(node)).toBeUndefined();
        });
    });

    describe("shapeCount", () => {
        test("should start at 0", () => {
            expect(context.shapeCount).toBe(0);
        });

        test("should increase when objects are added to visualShapes", () => {
            context.visualShapes.add(new Object3D());
            expect(context.shapeCount).toBe(1);
        });
    });

    describe("setVisible", () => {
        test("should not throw for unknown node", () => {
            expect(() => context.setVisible({} as VisualNode, false)).not.toThrow();
        });
    });

    describe("getMaterial", () => {
        test("should return material from map", () => {
            const mat = new MeshBasicMaterial();
            context.materialMap.set("test-id", mat);
            expect(context.getMaterial("test-id")).toBe(mat);
        });

        test("should throw for unknown material id", () => {
            expect(() => context.getMaterial("nonexistent")).toThrow("Material not found: nonexistent");
        });

        test("should throw for unknown material in array", () => {
            expect(() => context.getMaterial(["nonexistent1"])).toThrow();
        });

        test("should return array of materials for array input", () => {
            const mat1 = new MeshBasicMaterial();
            const mat2 = new MeshBasicMaterial();
            context.materialMap.set("id1", mat1);
            context.materialMap.set("id2", mat2);

            const result = context.getMaterial(["id1", "id2"]);
            expect(Array.isArray(result)).toBe(true);
            expect((result as MeshBasicMaterial[]).length).toBe(2);
        });

        test("should return single material when array has one element", () => {
            const mat = new MeshBasicMaterial();
            context.materialMap.set("id1", mat);

            const result = context.getMaterial(["id1"]);
            expect(result).toBe(mat);
        });
    });

    describe("dispose", () => {
        test("should clean up groups and clear maps", () => {
            context.materialMap.set("test", new MeshBasicMaterial());
            context.dispose();

            expect(context.materialMap.size).toBe(0);
        });

        test("should remove groups from scene", () => {
            context.dispose();
            expect(scene.children).not.toContain(context.visualShapes);
            expect(scene.children).not.toContain(context.tempShapes);
        });
    });

    describe("visuals", () => {
        test("should return empty array for empty visualShapes", () => {
            expect(context.visuals()).toEqual([]);
        });
    });

    describe("findShapes", () => {
        test("should return empty array for edge highlight state", () => {
            expect(context.findShapes(VisualStates.edgeHighlight)).toEqual([]);
        });

        test("should return visualShapes children for shape type", () => {
            const shapes = context.findShapes({} as any);
            expect(Array.isArray(shapes)).toBe(true);
        });
    });

    describe("displayMesh", () => {
        test("should return a group id for face mesh data", () => {
            const data = [
                {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                    index: new Uint32Array([0, 1, 2]),
                    groups: [],
                    range: [],
                    color: 0xff0000,
                },
            ];
            const id = context.displayMesh(data as any);
            expect(typeof id).toBe("number");
        });

        test("should return a group id for edge mesh data", () => {
            const data = [
                {
                    position: new Float32Array([0, 0, 0, 1, 0, 0]),
                    range: [],
                    color: 0x00ff00,
                    lineType: "solid",
                },
            ];
            const id = context.displayMesh(data as any);
            expect(typeof id).toBe("number");
        });
    });

    describe("removeMesh", () => {
        test("should not throw for invalid id", () => {
            expect(() => context.removeMesh(99999)).not.toThrow();
        });
    });

    describe("setMeshColor", () => {
        test("should not throw for invalid id", () => {
            expect(() => context.setMeshColor(99999, 0xff0000)).not.toThrow();
        });
    });

    describe("setPosition", () => {
        test("should not throw for invalid id", () => {
            expect(() => context.setPosition(99999, new Float32Array([]))).not.toThrow();
        });
    });

    describe("setInstanceMatrix", () => {
        test("should not throw for invalid id", () => {
            expect(() => context.setInstanceMatrix(99999, [])).not.toThrow();
        });
    });

    describe("moveNode", () => {
        test("should not throw for node with same parent", () => {
            const node = { parent: {} } as any;
            expect(() => context.moveNode(node, node.parent)).not.toThrow();
        });
    });

    describe("addNode / removeNode with real nodes", () => {
        beforeEach(() => {
            context.materialMap.set("mat-1", new MeshBasicMaterial());
        });

        test("addNode with duck-typed node does not throw", () => {
            const node = createTestGeometryNode();
            expect(() => context.addNode([node as any])).not.toThrow();
        });

        test("removeNode with unregistered node does not throw", () => {
            const node = createTestGeometryNode();
            expect(() => context.removeNode([node as any])).not.toThrow();
        });

        test("getVisual returns undefined for unregistered node", () => {
            const node = createTestGeometryNode();
            expect(context.getVisual(node as any)).toBeUndefined();
        });

        test("setVisible with unregistered node does not throw", () => {
            const node = createTestGeometryNode();
            expect(() => context.setVisible(node as any, false)).not.toThrow();
        });

        test("redrawNode handles single GeometryNode", () => {
            const node = createTestGeometryNode();
            expect(() => context.redrawNode([node as any])).not.toThrow();
        });
    });

    describe("setVisible with real visual", () => {
        test("setVisible does not throw for unregistered node", () => {
            const node = createTestGeometryNode();
            expect(() => context.setVisible(node as any, true)).not.toThrow();
        });
    });

    describe("displayMesh with real data", () => {
        test("displayMesh with face data returns non-zero id and adds to tempShapes", () => {
            const data = [
                {
                    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                    uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                    index: new Uint32Array([0, 1, 2]),
                    groups: [],
                    range: [],
                    color: 0xff0000,
                },
            ];
            const beforeCount = context.tempShapes.children.length;
            const id = context.displayMesh(data as any);
            expect(id).toBeGreaterThan(0);
            expect(context.tempShapes.children.length).toBeGreaterThan(beforeCount);

            // Clean up
            context.removeMesh(id);
        });

        test("displayInstancedMesh returns non-zero id", () => {
            const meshData = {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                index: new Uint32Array([0, 1, 2]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 0, 1]),
            };
            const id = context.displayInstancedMesh(meshData, [] as unknown as Matrix4[]);
            expect(id).toBeGreaterThan(0);

            context.removeMesh(id);
        });

        test("displayLineSegments returns non-zero id", () => {
            const id = context.displayLineSegments({
                lineType: "solid",
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [],
            } as any);
            expect(id).toBeGreaterThan(0);

            context.removeMesh(id);
        });
    });
});
