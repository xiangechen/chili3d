// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape, ISubShape, Matrix4, ShapeMeshRange, ShapeType } from "@chili3d/core";
import { Matrix4 as CoreMatrix4 } from "@chili3d/core";
import { Group, Mesh, MeshBasicMaterial, type Points } from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { highlightFaceMaterial, hilightEdgeMaterial, lockFaceMaterial } from "../src/materials";
import type { ThreeVisualContext } from "../src/threeVisualContext";
import {
    GroupVisualObject,
    ThreeComponentObject,
    ThreeMeshObject,
    ThreeVisualObject,
} from "../src/threeVisualObject";
import {
    createTestComponentNode,
    createTestGroupNode,
    createTestMeshNode,
    createTestVisualNode,
    createThreeMockVisualContext,
    disposeMeshes,
} from "./mocks";

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
        const node = createTestGroupNode();
        const gvo = new GroupVisualObject(node);
        expect(gvo.visible).toBe(true);
        expect(gvo.locked).toBe(false);
    });

    test("hidden node creates GroupVisualObject", () => {
        const node = createTestGroupNode({ visible: false });
        const gvo = new GroupVisualObject(node);
        expect(gvo).toBeInstanceOf(GroupVisualObject);
        expect(gvo.visible).toBe(true);
        expect(gvo.locked).toBe(false);
    });

    test("transform setter updates matrix elements", () => {
        const node = createTestGroupNode();
        const gvo = new GroupVisualObject(node);

        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 10, 15, 1]);
        gvo.transform = newMatrix;

        expect(gvo.transform.toArray()[12]).toBe(5);
        expect(gvo.transform.toArray()[13]).toBe(10);
        expect(gvo.transform.toArray()[14]).toBe(15);
    });

    test("locked triggers material swap on children", () => {
        const node = createTestGroupNode();
        const gvo = new GroupVisualObject(node);

        const childMesh = new Mesh();
        const originalMaterial = new MeshBasicMaterial();
        childMesh.material = originalMaterial;
        createdMeshes.push(childMesh);
        gvo.add(childMesh);

        expect(gvo.locked).toBe(false);
        gvo.locked = true;
        expect(gvo.locked).toBe(true);
        expect(childMesh.userData["oldMaterial"]).toBe(originalMaterial);
        expect(childMesh.material).toBe(lockFaceMaterial);

        gvo.locked = false;
        expect(gvo.locked).toBe(false);
        expect(childMesh.material).toBe(originalMaterial);
        expect(childMesh.userData["oldMaterial"]).toBeUndefined();
    });

    test("setting locked to same value is a no-op", () => {
        const node = createTestGroupNode();
        const gvo = new GroupVisualObject(node);

        expect(gvo.locked).toBe(false);
        gvo.locked = false;
        expect(gvo.locked).toBe(false);

        gvo.locked = true;
        gvo.locked = true;
        expect(gvo.locked).toBe(true);
    });

    test("dispose unsubscribes from property changes", () => {
        const node = createTestGroupNode();
        const gvo = new GroupVisualObject(node);
        gvo.dispose();

        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);
        const fakeNode = node as unknown as { transform: Matrix4; _notify: (p: string) => void };
        Object.defineProperty(fakeNode, "transform", {
            get() {
                return newMatrix;
            },
            configurable: true,
        });
        fakeNode._notify("transform");

        // The handler was removed, so the visual keeps its old transform
        expect(gvo.transform.toArray()[12]).toBe(0);
    });

    test("node transform change is reflected via property observer", () => {
        const node = createTestGroupNode();
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
        const node = createTestVisualNode();
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
        const node = createTestVisualNode();
        const obj = new TestableVisualObject(node);

        const matrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);
        obj.transform = matrix;
        expect(obj.matrix.elements[12]).toBe(10);
    });

    test("transform setter refreshes worldTransform without a render", () => {
        const parent = new Group();
        parent.position.set(1, 0, 0);
        parent.updateMatrixWorld();
        const obj = new TestableVisualObject(createTestVisualNode());
        parent.add(obj);

        obj.transform = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);

        // no updateMatrixWorld() in between: listeners on "transform" read this synchronously
        expect(obj.worldTransform().toArray()[12]).toBe(11);
    });

    test("visible false when node is not visible", () => {
        const node = createTestVisualNode({ visible: false });
        expect(new TestableVisualObject(node).visible).toBe(false);
    });

    test("visible true when node.visible and node.parentVisible are true", () => {
        const node = createTestVisualNode({ visible: true, parentVisible: true });
        expect(new TestableVisualObject(node).visible).toBe(true);
    });

    test("locked toggles child materials", () => {
        const node = createTestVisualNode();
        const obj = new TestableVisualObject(node);

        const child = new Mesh();
        const originalMaterial = new MeshBasicMaterial({ color: 0xff0000 });
        child.material = originalMaterial;
        createdMeshes.push(child);
        obj.add(child);

        obj.locked = true;
        expect(obj.locked).toBe(true);
        expect(child.userData["oldMaterial"]).toBe(originalMaterial);
        expect(child.material).toBe(lockFaceMaterial);

        obj.locked = false;
        expect(obj.locked).toBe(false);
        expect(child.material).toBe(originalMaterial);
        expect(child.userData["oldMaterial"]).toBeUndefined();
    });

    test("matrixAutoUpdate is false after construction", () => {
        const node = createTestVisualNode();
        const obj = new TestableVisualObject(node);
        expect(obj.matrixAutoUpdate).toBe(false);
    });

    test("dispose removes property change handler", () => {
        const node = createTestVisualNode();
        const obj = new TestableVisualObject(node);
        obj.dispose();

        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);
        const fakeNode = node as unknown as { transform: Matrix4; _notify: (p: string) => void };
        Object.defineProperty(fakeNode, "transform", {
            get() {
                return newMatrix;
            },
            configurable: true,
        });
        fakeNode._notify("transform");

        // The handler was removed, so the visual keeps its old transform
        expect(obj.transform.toArray()[12]).toBe(0);
    });
});

// ============================================================================
// ThreeMeshObject
// ============================================================================

describe("ThreeMeshObject", () => {
    let context: ThreeVisualContext;

    beforeEach(() => {
        context = createThreeMockVisualContext();
    });

    test("creates ThreeMeshObject with surface mesh type", () => {
        const node = createTestMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        expect(obj.mesh).toBeInstanceOf(Mesh);
        expect(obj.visible).toBe(true);
    });

    test("creates ThreeMeshObject with linesegments mesh type", () => {
        const node = createTestMeshNode({ meshType: "linesegments" });
        const obj = new ThreeMeshObject(context, node);
        expect(obj.mesh).toBeInstanceOf(LineSegments2);
    });

    test("wholeVisual returns array with the mesh", () => {
        const node = createTestMeshNode();
        const obj = new ThreeMeshObject(context, node);
        const visuals = obj.wholeVisual();
        expect(visuals.length).toBe(1);
        expect(visuals[0]).toBe(obj.mesh);
    });

    test("subShapeVisual returns empty array", () => {
        const node = createTestMeshNode();
        const obj = new ThreeMeshObject(context, node);
        expect(obj.subShapeVisual(1)).toEqual([]);
    });

    test("getSubShapeAndIndex returns empty result", () => {
        const node = createTestMeshNode();
        const obj = new ThreeMeshObject(context, node);
        const result = obj.getSubShapeAndIndex("face", 0);
        expect(result.shape).toBeUndefined();
        expect(result.subShape).toBeUndefined();
        expect(result.index).toBe(-1);
    });

    test("highlight on surface mesh swaps in the highlight material", () => {
        const node = createTestMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        const originalMaterial = obj.mesh.material;

        obj.highlight();
        expect(obj.mesh.material).toBe(highlightFaceMaterial);
        expect(obj.mesh.material).not.toBe(originalMaterial);
    });

    test("unhighlight restores original material on surface mesh", () => {
        const node = createTestMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        const originalMaterial = obj.mesh.material;

        obj.highlight();
        expect(obj.mesh.material).toBe(highlightFaceMaterial);

        obj.unhighlight();
        expect(obj.mesh.material).toBe(originalMaterial);
    });

    test("highlight on linesegments mesh swaps in the highlight material", () => {
        const node = createTestMeshNode({ meshType: "linesegments" });
        const obj = new ThreeMeshObject(context, node);
        const originalMaterial = obj.mesh.material;

        obj.highlight();
        expect(obj.mesh.material).toBe(hilightEdgeMaterial);
        expect(obj.mesh.material).not.toBe(originalMaterial);
    });

    test("unhighlight restores original material on linesegments mesh", () => {
        const node = createTestMeshNode({ meshType: "linesegments" });
        const obj = new ThreeMeshObject(context, node);
        const originalMaterial = obj.mesh.material;

        obj.highlight();
        expect(obj.mesh.material).toBe(hilightEdgeMaterial);

        obj.unhighlight();
        expect(obj.mesh.material).toBe(originalMaterial);
    });

    test("mesh property change recreates the mesh", () => {
        const node = createTestMeshNode({ meshType: "surface" });
        const obj = new ThreeMeshObject(context, node);
        const oldMesh = obj.mesh;

        (node as unknown as { _notify: (p: string) => void })._notify("mesh");

        expect(obj.mesh).not.toBe(oldMesh);
        expect(obj.mesh).toBeInstanceOf(Mesh);
        expect(obj.children).toContain(obj.mesh);
    });

    test("materialId change replaces the mesh material", () => {
        const node = createTestMeshNode({ meshType: "surface", materialId: "mat-1" });
        const obj = new ThreeMeshObject(context, node);
        const oldMaterial = obj.mesh.material;

        (node as unknown as { _notify: (p: string) => void })._notify("materialId");

        // The mock context returns a new material instance per getMaterial call
        expect(obj.mesh.material).not.toBe(oldMaterial);
    });

    test("dispose disposes the mesh geometry and detaches handlers", () => {
        const node = createTestMeshNode();
        const obj = new ThreeMeshObject(context, node);

        let geometryDisposed = false;
        obj.mesh.geometry.addEventListener("dispose", () => {
            geometryDisposed = true;
        });

        obj.dispose();
        expect(geometryDisposed).toBe(true);

        // Property changes after dispose no longer recreate the mesh
        const meshAfterDispose = obj.mesh;
        (node as unknown as { _notify: (p: string) => void })._notify("mesh");
        expect(obj.mesh).toBe(meshAfterDispose);
    });

    test("hidden node creates invisible visual", () => {
        const node = createTestMeshNode({ visible: false });
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
        context = createThreeMockVisualContext();
    });

    function makeFakeNode() {
        return createTestComponentNode() as any;
    }

    test("creates with visible and locked defaults", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj).toBeInstanceOf(ThreeComponentObject);
        expect(obj.visible).toBe(true);
        expect(obj.locked).toBe(false);
    });

    test("edges property is a LineSegments2", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.edges).toBeInstanceOf(LineSegments2);
    });

    test("faces property is a Mesh", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.faces).toBeInstanceOf(Mesh);
    });

    test("linesegments property is a LineSegments2", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.linesegments).toBeInstanceOf(LineSegments2);
    });

    test("surfaces property is a Mesh", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect(obj.surfaces).toBeInstanceOf(Mesh);
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
        expect((result.shape as any)?.id).toBe("f1");
        expect(result.subShape).toBe(result.shape);
        expect(result.index).toBe(0);
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
        expect(box!.min.x).toBe(0);
        expect(box!.max.x).toBe(10);
    });

    test("highlight creates a visible bounding box helper", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        expect((obj as any)._boundbox).toBeUndefined();

        obj.highlight();
        const boundbox = (obj as any)._boundbox as LineSegments2;
        expect(boundbox).toBeInstanceOf(LineSegments2);
        expect(boundbox.visible).toBe(true);
        expect(obj.children).toContain(boundbox);
    });

    test("double highlight reuses the same bounding box helper", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        obj.highlight();
        const boundbox = (obj as any)._boundbox as LineSegments2;
        const childCount = obj.children.length;

        obj.highlight();
        expect((obj as any)._boundbox).toBe(boundbox);
        expect(obj.children.length).toBe(childCount);
    });

    test("unhighlight when not highlighted creates no bounding box helper", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        obj.unhighlight();
        expect((obj as any)._boundbox).toBeUndefined();
    });

    test("unhighlight after highlight hides the bounding box helper", () => {
        const obj = new ThreeComponentObject(makeFakeNode(), context);
        obj.highlight();
        const boundbox = (obj as any)._boundbox as LineSegments2;
        expect(boundbox.visible).toBe(true);

        obj.unhighlight();
        expect(boundbox.visible).toBe(false);
    });

    test("dispose detaches the node property change handler", () => {
        const node = makeFakeNode();
        const obj = new ThreeComponentObject(node, context);
        obj.dispose();

        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);
        Object.defineProperty(node, "transform", {
            get() {
                return newMatrix;
            },
            configurable: true,
        });
        (node as { _notify: (p: string) => void })._notify("transform");

        // The handler was removed, so the visual keeps its old transform
        expect(obj.transform.toArray()[12]).toBe(0);
    });
});
