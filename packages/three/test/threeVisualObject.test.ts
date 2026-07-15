// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type {
    GroupNode,
    IShape,
    ISubShape,
    Matrix4,
    ShapeMeshRange,
    ShapeType,
    VisualNode,
} from "@chili3d/core";
import { Matrix4 as CoreMatrix4 } from "@chili3d/core";
import { Mesh, MeshBasicMaterial, type Points } from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { GroupVisualObject, ThreeVisualObject } from "../src/threeVisualObject";

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

/**
 * Creates a minimal fake node with Observable-like property change notification.
 */
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
        // Call to simulate property changes
        _notify(prop: string) {
            for (const cb of listeners) cb(prop);
        },
        ...overrides,
    } as unknown as VisualNode;
}

function createFakeGroupNode(overrides: Record<string, unknown> = {}): GroupNode {
    return createFakeVisualNode(overrides) as unknown as GroupNode;
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

    test("hidden node creates GroupVisualObject (visible not synced from node)", () => {
        // GroupVisualObject does not inherit node.visible in its constructor;
        // it inherits the default true from Object3D
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
        // Lock material should have been saved
        expect(childMesh.userData["oldMaterial"]).toBeDefined();

        gvo.locked = false;
        expect(gvo.locked).toBe(false);
    });

    test("setting locked to same value is a no-op", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);

        expect(gvo.locked).toBe(false);
        gvo.locked = false; // No change
        expect(gvo.locked).toBe(false);

        gvo.locked = true;
        gvo.locked = true; // No change
        expect(gvo.locked).toBe(true);
    });

    test("dispose unsubscribes from property changes", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);
        gvo.dispose();
        // After dispose, notification should not throw
        expect(() =>
            (node as unknown as { _notify: (p: string) => void })._notify("transform"),
        ).not.toThrow();
    });

    test("node transform change is reflected via property observer", () => {
        const node = createFakeGroupNode();
        const gvo = new GroupVisualObject(node);

        // Directly set a new transform on the node and notify
        const newMatrix = CoreMatrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);

        // Override the node transform and trigger notification
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
        // Notification should not throw after dispose
        expect(() =>
            (node as unknown as { _notify: (p: string) => void })._notify("transform"),
        ).not.toThrow();
    });
});
