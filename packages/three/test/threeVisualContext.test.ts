// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDocument,
    type IVisual,
    type IVisualObject,
    Material,
    type Matrix4,
    type VisualNode,
    VisualStates,
} from "@chili3d/core";
import { createMockVisual, TestDocument } from "@chili3d/core/test-utils";
import { Group, MeshBasicMaterial, type MeshPhysicalMaterial, Object3D, Scene, Texture } from "three";
import { ThreeVisualContext } from "../src/threeVisualContext";
import { createTestGeometryNode } from "./mocks";

/**
 * Wraps core createMockVisual with a document whose modelManager tracks the
 * observers registered by the ThreeVisualContext constructor.
 */
function createVisualWithObserverTracking(): {
    visual: IVisual;
    nodeObservers: Array<(records: unknown[]) => void>;
    materialHandlers: Array<(args: unknown) => void>;
} {
    const nodeObservers: Array<(records: unknown[]) => void> = [];
    const collectionHandlers: Array<(args: unknown) => void> = [];

    const document = {
        modelManager: {
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
        },
    } as unknown as IDocument;

    return { visual: createMockVisual({ document }), nodeObservers, materialHandlers: collectionHandlers };
}

describe("ThreeVisualContext (real instance)", () => {
    let context: ThreeVisualContext;
    let scene: Scene;
    let visual: IVisual;
    let nodeObservers: Array<(records: unknown[]) => void>;
    let materialHandlers: Array<(args: unknown) => void>;

    beforeEach(() => {
        const tracked = createVisualWithObserverTracking();
        visual = tracked.visual;
        nodeObservers = tracked.nodeObservers;
        materialHandlers = tracked.materialHandlers;
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
            expect(nodeObservers.length).toBeGreaterThan(0);
        });
    });

    describe("material environment", () => {
        /** Announces a material the way the model manager does, and hands back its three material. */
        function addMaterial(material: Material): MeshPhysicalMaterial {
            materialHandlers[0]({ action: "add", items: [material] });
            return context.materialMap.get(material.id) as MeshPhysicalMaterial;
        }

        function documentMaterial() {
            return new Material({ document: new TestDocument(), name: "m", color: 0x112233 });
        }

        test("should leave a material alone until the scene has an environment", () => {
            const material = documentMaterial();
            material.envMapIntensity = 2;

            const threeMaterial = addMaterial(material);

            expect(scene.environment).toBeNull();
            expect(threeMaterial.envMap).toBeNull();
        });

        test("should attach the scene's environment, at the material's own reflection strength", () => {
            const environment = new Texture();
            scene.environment = environment;
            const material = documentMaterial();
            material.envMapIntensity = 2;

            const threeMaterial = addMaterial(material);

            expect(threeMaterial.envMap).toBe(environment);
            expect(threeMaterial.envMapIntensity).toBe(2);
        });

        test("should rebuild the program when a material gets a texture", () => {
            const material = documentMaterial();
            const threeMaterial = addMaterial(material);
            const builtWithout = threeMaterial.version;

            material.map.image = "data:image/png;base64,AAAA";

            // the program was compiled without a map, so it has to be rebuilt for the shader to
            // sample one at all — a refreshed uniform would not be enough
            expect(threeMaterial.map).not.toBeNull();
            expect(threeMaterial.version).toBeGreaterThan(builtWithout);
        });

        test("should take the map away when the image is cleared", () => {
            const material = documentMaterial();
            material.map.image = "data:image/png;base64,AAAA";
            const threeMaterial = addMaterial(material);
            expect(threeMaterial.map).not.toBeNull();

            material.map.image = "";

            expect(threeMaterial.map).toBeNull();
        });

        test("should follow the strength as it changes", () => {
            // the renderer overwrites a material's intensity with the scene's while the environment
            // comes from the scene, which is why the material is given the map itself
            scene.environment = new Texture();
            const material = documentMaterial();

            const threeMaterial = addMaterial(material);
            material.envMapIntensity = 3;

            expect(threeMaterial.envMapIntensity).toBe(3);
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
        test("should ignore unknown node", () => {
            context.setVisible({} as VisualNode, false);
            expect(context.shapeCount).toBe(0);
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

        test("should unregister the node observer", () => {
            expect(nodeObservers.length).toBeGreaterThan(0);
            context.dispose();
            expect(nodeObservers.length).toBe(0);
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

    describe("temp shape operations with invalid id", () => {
        test("removeMesh ignores unknown id", () => {
            context.removeMesh(99999);
            expect(context.tempShapes.children.length).toBe(0);
        });

        test("setMeshColor ignores unknown id", () => {
            context.setMeshColor(99999, 0xff0000);
            expect(context.tempShapes.children.length).toBe(0);
        });

        test("setPosition ignores unknown id", () => {
            context.setPosition(99999, new Float32Array([]));
            expect(context.tempShapes.children.length).toBe(0);
        });

        test("setInstanceMatrix ignores unknown id", () => {
            context.setInstanceMatrix(99999, []);
            expect(context.tempShapes.children.length).toBe(0);
        });
    });

    describe("moveNode", () => {
        test("should ignore node whose parent did not change", () => {
            const node = { parent: {} } as any;
            context.moveNode(node, node.parent);
            expect(context.getVisual(node)).toBeUndefined();
            expect(context.shapeCount).toBe(0);
        });
    });

    describe("addNode / removeNode with real nodes", () => {
        beforeEach(() => {
            context.materialMap.set("mat-1", new MeshBasicMaterial());
        });

        test("addNode with duck-typed node creates no visual", () => {
            const node = createTestGeometryNode();
            context.addNode([node as any]);
            // Duck-typed nodes fail the instanceof checks in displayNode
            expect(context.getVisual(node as any)).toBeUndefined();
            expect(context.shapeCount).toBe(0);
        });

        test("removeNode with unregistered node keeps the scene unchanged", () => {
            const node = createTestGeometryNode();
            context.removeNode([node as any]);
            expect(context.getVisual(node as any)).toBeUndefined();
            expect(context.shapeCount).toBe(0);
        });

        test("getVisual returns undefined for unregistered node", () => {
            const node = createTestGeometryNode();
            expect(context.getVisual(node as any)).toBeUndefined();
        });

        test("setVisible with unregistered node changes nothing", () => {
            const node = createTestGeometryNode();
            context.setVisible(node as any, false);
            expect(context.getVisual(node as any)).toBeUndefined();
            expect(context.shapeCount).toBe(0);
        });

        test("redrawNode on duck-typed node creates no visual", () => {
            const node = createTestGeometryNode();
            context.redrawNode([node as any]);
            expect(context.getVisual(node as any)).toBeUndefined();
            expect(context.shapeCount).toBe(0);
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
