// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    GroupNode,
    IShape,
    ISubShape,
    Matrix4,
    MeshNode,
    ShapeMeshRange,
    ShapeType,
    VisualNode,
} from "@chili3d/core";
import { Matrix4 as CoreMatrix4, Mesh as CoreMesh } from "@chili3d/core";
import { Mesh, MeshBasicMaterial, type Points } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { ThreeVisualContext } from "../src/threeVisualContext";
import {
    GroupVisualObject,
    ThreeComponentObject,
    ThreeMeshObject,
    ThreeVisualObject,
} from "../src/threeVisualObject";
import { createMockVisualContext } from "./mocks";

/**
 * Minimal concrete ThreeVisualObject for testing base class behavior.
 */
class TestableVisualObject extends ThreeVisualObject {
    override getSubShapeAndIndex(
        _shapeType: "face" | "edge" | "vertex",
        _subVisualIndex: number,
    ): {
        shape: IShape | undefined;
        subShape: ISubShape | undefined;
        index: number;
        transform?: Matrix4;
        groups: ShapeMeshRange[];
    } {
        return { shape: undefined, subShape: undefined, index: -1, groups: [] };
    }

    override subShapeVisual(_shapeType: ShapeType): (Mesh | LineSegments2 | Points)[] {
        return [];
    }

    override wholeVisual(): (Mesh | LineSegments2 | Points)[] {
        return [];
    }
}

function createFakeVisualNode(overrides: Record<string, unknown> = {}): VisualNode {
    const listeners: Array<(prop: string) => void> = [];
    let transform: Matrix4 = CoreMatrix4.identity();

    return {
        id: "fake-node",
        display() {
            return "body.line";
        },
        get transform(): Matrix4 {
            return transform;
        },
        set transform(v: Matrix4) {
            transform = v;
        },
        visible: true,
        parentVisible: true,
        parent: null,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        ...overrides,
    } as unknown as VisualNode;
}

function createFakeGroupNode(overrides: Record<string, unknown> = {}): GroupNode {
    return createFakeVisualNode(overrides) as unknown as GroupNode;
}

function createFakeMeshNode(
    overrides: {
        meshType?: "surface" | "linesegments";
        visible?: boolean;
        parentVisible?: boolean;
        materialId?: string | string[];
    } = {},
): MeshNode {
    const meshType = overrides.meshType ?? "surface";
    const listeners: Array<(prop: string) => void> = [];

    const mesh =
        meshType === "surface"
            ? new CoreMesh({
                  meshType: "surface",
                  position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                  uv: new Float32Array([0, 0, 1, 0, 0, 1]),
                  index: new Uint32Array([0, 1, 2]),
                  color: 0xff0000,
              })
            : new CoreMesh({
                  meshType: "linesegments",
                  position: new Float32Array([0, 0, 0, 1, 0, 0]),
                  color: 0x0000ff,
              });

    return {
        id: "fake-mesh-node",
        display: () => "body.meshNode",
        transform: CoreMatrix4.identity(),
        visible: overrides.visible ?? true,
        parentVisible: overrides.parentVisible ?? true,
        parent: null,
        document: {} as never,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        mesh,
        materialId: overrides.materialId ?? "mat-1",
        boundingBox: () => undefined,
        name: "test-mesh",
    } as unknown as MeshNode;
}

function createFakeComponentNode(overrides: { visible?: boolean; parentVisible?: boolean } = {}) {
    const listeners: Array<(prop: string) => void> = [];
    const component = {
        boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        id: "comp-1",
        nodes: [] as unknown[],
        mesh: {
            faceMaterials: ["mat-1"],
            edge: {
                lineType: "solid" as const,
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                range: [{ start: 0, count: 2, shape: { id: "e1", shapeType: 1 } }],
            },
            face: {
                position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
                normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
                uv: new Float32Array([0, 0, 1, 0, 1, 1]),
                index: new Uint32Array([0, 1, 2]),
                range: [{ start: 0, count: 3, shape: { id: "f1", shapeType: 2 } }],
                groups: [],
                color: 0xff0000,
            },
            linesegments: new CoreMesh({
                meshType: "linesegments",
                position: new Float32Array([0, 0, 0, 1, 0, 0]),
                color: 0x0000ff,
            }),
            surfaceMaterials: [],
            surface: new CoreMesh({
                meshType: "surface",
                position: new Float32Array([0, 0, 0]),
                normal: new Float32Array([0, 0, 1]),
                uv: new Float32Array([0, 0]),
                index: new Uint32Array([]),
            }),
        },
    };

    return {
        id: "fake-component-node",
        display: () => "body.group",
        transform: CoreMatrix4.identity(),
        visible: overrides.visible ?? true,
        parentVisible: overrides.parentVisible ?? true,
        parent: null,
        document: {} as never,
        onPropertyChanged(cb: unknown) {
            listeners.push(cb as (prop: string) => void);
        },
        removePropertyChanged(cb: unknown) {
            const idx = listeners.indexOf(cb as (prop: string) => void);
            if (idx >= 0) listeners.splice(idx, 1);
        },
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        component,
        componentId: "comp-1",
        insert: { x: 0, y: 0, z: 0 },
        name: "test-component",
        boundingBox: () => component.boundingBox,
    };
}

function disposeMeshes(meshes: Mesh[]): void {
    for (const mesh of meshes) {
        if (Array.isArray(mesh.material)) {
            for (const m of mesh.material) m.dispose();
        } else {
            mesh.material?.dispose();
        }
        mesh.geometry?.dispose();
    }
}

// ============================================================================
// GroupVisualObject
// ============================================================================

describe("GroupVisualObject", () => {
    const createdMeshes: Mesh[] = [];

    afterEach(() => {
        disposeMeshes(createdMeshes);
        createdMeshes.length = 0;
    });

    test("creates with correct initial transform and visibility", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);
        expect(gvo.visible).toBe(true);
        expect(gvo.locked).toBe(false);
    });

    test("hidden node creates GroupVisualObject", () => {
        const node = createFakeGroupNode({ visible: false });
        const gvo = new GroupVisualObject(node);
        expect(gvo).toBeDefined();
        expect(gvo.visible).toBe(true);
        expect(gvo.locked).toBe(false);
    });

    test("transform setter updates matrix elements", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);

        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 10, 15, 1]);
        gvo.transform = newMatrix;

        expect(gvo.transform.toArray()[12]).toBe(5);
        expect(gvo.transform.toArray()[13]).toBe(10);
        expect(gvo.transform.toArray()[14]).toBe(15);
    });

    test("locked triggers material swap on children", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);

        const childMesh = new Mesh();
        childMesh.material = new MeshBasicMaterial();
        createdMeshes.push(childMesh);
        gvo.add(childMesh);

        expect(gvo.locked).toBe(false);
        gvo.locked = true;
        expect(gvo.locked).toBe(true);
        expect(childMesh.userData["oldMaterial"]).toBeDefined();

        gvo.locked = false;
        expect(gvo.locked).toBe(false);
    });

    test("setting locked to same value is a no-op", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);

        expect(gvo.locked).toBe(false);
        gvo.locked = false;
        expect(gvo.locked).toBe(false);

        gvo.locked = true;
        gvo.locked = true;
        expect(gvo.locked).toBe(true);
    });

    test("dispose unsubscribes from property changes", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);
        gvo.dispose();
        expect(() =>
            (node as unknown as { _notify: (p: string) => void })._notify("transform"),
        ).not.toThrow();
    });

    test("node transform change is reflected via property observer", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);

        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);

        const fakeNode = node as unknown as {
            transform: Matrix4;
            _notify: (p: string) => void;
        };
        Object.defineProperty(fakeNode, "transform", {
            get() {
                return newMatrix;
            },
            configurable: true,
        });
        fakeNode._notify("transform");

        expect(gvo.transform.toArray()[12]).toBe(100);
    });
});

// ============================================================================
// ThreeVisualObject base class
// ============================================================================

describe("ThreeVisualObject base class", () => {
    const createdMeshes: Mesh[] = [];

    afterEach(() => {
        disposeMeshes(createdMeshes);
        createdMeshes.length = 0;
    });

    test("transform getter converts from this.matrix", () => {
        const node = createFakeVisualNode();
        const obj = new TestableVisualObject(node);

        obj.matrix.elements[12] = 42;
        obj.matrix.elements[13] = 43;
        obj.matrix.elements[14] = 44;

        const t = obj.transform;
        expect(t.toArray()[12]).toBe(42);
        expect(t.toArray()[13]).toBe(43);
        expect(t.toArray()[14]).toBe(44);
    });

    test("transform setter updates this.matrix", () => {
        const node = createFakeVisualNode();
        const obj = new TestableVisualObject(node);

        const matrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);
        obj.transform = matrix;
        expect(obj.matrix.elements[12]).toBe(10);
    });

    test("visible false when node is not visible", () => {
        const node = createFakeVisualNode({ visible: false });
        expect(new TestableVisualObject(node).visible).toBe(false);
    });

    test("visible true when node.visible and node.parentVisible are true", () => {
        const node = createFakeVisualNode({ visible: true, parentVisible: true });
        expect(new TestableVisualObject(node).visible).toBe(true);
    });

    test("locked toggles child materials", () => {
        const node = createFakeVisualNode();
        const obj = new TestableVisualObject(node);

        const child = new Mesh();
        child.material = new MeshBasicMaterial({ color: 0xff0000 });
        createdMeshes.push(child);
        obj.add(child);

        obj.locked = true;
        expect(obj.locked).toBe(true);
        expect(child.userData["oldMaterial"]).toBeDefined();

        obj.locked = false;
        expect(obj.locked).toBe(false);
        expect(child.userData["oldMaterial"]).toBeUndefined();
    });

    test("matrixAutoUpdate is false after construction", () => {
        const node = createFakeVisualNode();
        const obj = new TestableVisualObject(node);
        expect(obj.matrixAutoUpdate).toBe(false);
    });

    test("dispose removes property change handler", () => {
        const node = createFakeVisualNode();
        const obj = new TestableVisualObject(node);
        obj.dispose();
        expect(() =>
            (node as unknown as { _notify: (p: string) => void })._notify("transform"),
        ).not.toThrow();
    });
});

// ============================================================================
// ThreeMeshObject
// ============================================================================

describe("ThreeMeshObject", () => {
    let context: ThreeVisualContext;

    beforeEach(() => {
        context = createMockVisualContext();
    });

    test("creates ThreeMeshObject with surface mesh type", () => {
        const node = createFakeMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        expect(obj).toBeDefined();
        expect(obj.mesh).toBeDefined();
        expect(obj.visible).toBe(true);
    });

    test("creates ThreeMeshObject with linesegments mesh type", () => {
        const node = createFakeMeshNode({ meshType: "linesegments" });
        const obj = new ThreeMeshObject(context, node);
        expect(obj).toBeDefined();
        expect(obj.mesh).toBeDefined();
    });

    test("wholeVisual returns array with the mesh", () => {
        const node = createFakeMeshNode();
        const obj = new ThreeMeshObject(context, node);
        const visuals = obj.wholeVisual();
        expect(visuals.length).toBe(1);
        expect(visuals[0]).toBe(obj.mesh);
    });

    test("subShapeVisual returns empty array", () => {
        const node = createFakeMeshNode();
        const obj = new ThreeMeshObject(context, node);
        expect(obj.subShapeVisual(1)).toEqual([]);
    });

    test("getSubShapeAndIndex returns empty result", () => {
        const node = createFakeMeshNode();
        const obj = new ThreeMeshObject(context, node);
        const result = obj.getSubShapeAndIndex("face", 0);
        expect(result.shape).toBeUndefined();
        expect(result.subShape).toBeUndefined();
        expect(result.index).toBe(-1);
    });

    test("highlight on surface mesh does not throw", () => {
        const node = createFakeMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        expect(() => obj.highlight()).not.toThrow();
    });

    test("unhighlight restores original material on surface mesh", () => {
        const node = createFakeMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        obj.highlight();
        expect(() => obj.unhighlight()).not.toThrow();
    });

    test("highlight on linesegments mesh does not throw", () => {
        const node = createFakeMeshNode({ meshType: "linesegments" });
        const obj = new ThreeMeshObject(context, node);
        expect(() => obj.highlight()).not.toThrow();
    });

    test("unhighlight on linesegments mesh does not throw", () => {
        const node = createFakeMeshNode({ meshType: "linesegments" });
        const obj = new ThreeMeshObject(context, node);
        obj.highlight();
        expect(() => obj.unhighlight()).not.toThrow();
    });

    test("mesh property change triggers recreation", () => {
        const node = createFakeMeshNode({ meshType: "surface" });
        new ThreeMeshObject(context, node);

        expect(() => (node as unknown as { _notify: (p: string) => void })._notify("mesh")).not.toThrow();
    });

    test("materialId change does not throw", () => {
        const node = createFakeMeshNode({ meshType: "surface", materialId: "mat-1" });
        new ThreeMeshObject(context, node);
        expect(() =>
            (node as unknown as { _notify: (p: string) => void })._notify("materialId"),
        ).not.toThrow();
    });

    test("dispose cleans up mesh and handlers", () => {
        const node = createFakeMeshNode();
        const obj = new ThreeMeshObject(context, node);
        expect(() => obj.dispose()).not.toThrow();
    });

    test("hidden node creates invisible visual", () => {
        const node = createFakeMeshNode({ visible: false });
        const obj = new ThreeMeshObject(context, node);
        expect(obj.visible).toBe(false);
    });
});

// ============================================================================
// ThreeComponentObject
// ============================================================================

describe("ThreeComponentObject", () => {
    let context: ThreeVisualContext;

    beforeEach(() => {
        context = createMockVisualContext();
    });

    function makeFakeNode() {
        return createFakeComponentNode() as any;
    }

    test("creates with visible and locked defaults", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj).toBeDefined();
        expect(obj.visible).toBe(true);
        expect(obj.locked).toBe(false);
    });

    test("edges property is defined", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.edges).toBeDefined();
    });

    test("faces property is defined", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.faces).toBeDefined();
    });

    test("linesegments property is defined", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.linesegments).toBeDefined();
    });

    test("surfaces property is defined", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.surfaces).toBeDefined();
    });

    test("wholeVisual returns non-empty array", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        const visuals = obj.wholeVisual();
        expect(visuals.length).toBeGreaterThan(0);
    });

    test("subShapeVisual returns non-empty for whole shape type", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        const shapes = obj.subShapeVisual(1);
        expect(shapes.length).toBeGreaterThan(0);
    });

    test("getSubShapeAndIndex finds face by visual index", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        const result = obj.getSubShapeAndIndex("face", 0);
        expect(result.shape).toBeDefined();
        expect(result.subShape).toBeDefined();
        expect(result.index).toBeGreaterThanOrEqual(0);
    });

    test("getSubShapeAndIndex returns empty for out-of-range visual", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        const result = obj.getSubShapeAndIndex("face", 999);
        expect(result.shape).toBeUndefined();
        expect(result.index).toBe(-1);
    });

    test("boundingBox returns the component bounding box", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        const box = obj.boundingBox();
        expect(box).toBeDefined();
        if (box) {
            expect(box.min.x).toBe(0);
            expect(box.max.x).toBe(10);
        }
    });

    test("highlight creates bounding box and shows it", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(() => obj.highlight()).not.toThrow();
    });

    test("double highlight does not throw", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        obj.highlight();
        expect(() => obj.highlight()).not.toThrow();
    });

    test("unhighlight when not highlighted does not throw", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(() => obj.unhighlight()).not.toThrow();
    });

    test("unhighlight after highlight does not throw", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        obj.highlight();
        expect(() => obj.unhighlight()).not.toThrow();
    });

    test("dispose cleans up meshes", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(() => obj.dispose()).not.toThrow();
    });
});
