// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Material, Matrix4, PhongMaterial, PhysicalMaterial, XYZ } from "@chili3d/core";
import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Matrix4 as ThreeMatrix4,
    Vector3,
} from "three";
import { TestDocument } from "../../core/test/mocks";
import { ThreeHelper } from "../src/threeHelper";

describe("ThreeHelper", () => {
    describe("toMatrix / fromMatrix", () => {
        test("round-trip from core Matrix4 to Three.js and back", () => {
            const core = Matrix4.identity();
            const three = ThreeHelper.fromMatrix(core);
            const back = ThreeHelper.toMatrix(three);
            expect(back.equals(core)).toBe(true);
        });

        test("fromMatrix translates correctly", () => {
            const core = Matrix4.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
            const three = ThreeHelper.fromMatrix(core);
            expect(three.elements[12]).toBe(10);
            expect(three.elements[13]).toBe(20);
            expect(three.elements[14]).toBe(30);
        });

        test("toMatrix translates correctly", () => {
            const three = new ThreeMatrix4();
            three.elements[12] = 5;
            three.elements[13] = 10;
            three.elements[14] = 15;
            const core = ThreeHelper.toMatrix(three);
            const arr = core.toArray();
            expect(arr[12]).toBe(5);
            expect(arr[13]).toBe(10);
            expect(arr[14]).toBe(15);
        });

        test("handles zero matrix", () => {
            const core = Matrix4.zero();
            const three = ThreeHelper.fromMatrix(core);
            const back = ThreeHelper.toMatrix(three);
            expect(back.equals(core)).toBe(true);
        });
    });

    describe("toXYZ / fromXYZ", () => {
        test("round-trip from core XYZ to Three.js Vector3 and back", () => {
            const core = new XYZ({ x: 1, y: 2, z: 3 });
            const three = ThreeHelper.fromXYZ(core);
            const back = ThreeHelper.toXYZ(three);
            expect(back.x).toBe(1);
            expect(back.y).toBe(2);
            expect(back.z).toBe(3);
        });

        test("fromXYZ with zero vector", () => {
            const three = ThreeHelper.fromXYZ(XYZ.zero);
            expect(three.x).toBe(0);
            expect(three.y).toBe(0);
            expect(three.z).toBe(0);
        });

        test("fromXYZ with negative values", () => {
            const core = new XYZ({ x: -5, y: -10, z: -15 });
            const three = ThreeHelper.fromXYZ(core);
            expect(three.x).toBe(-5);
            expect(three.y).toBe(-10);
            expect(three.z).toBe(-15);
        });

        test("toXYZ from plain object with x,y,z", () => {
            const vec = { x: 7, y: 8, z: 9 };
            const result = ThreeHelper.toXYZ(vec as Vector3);
            expect(result.x).toBe(7);
            expect(result.y).toBe(8);
            expect(result.z).toBe(9);
        });
    });

    describe("fromColor / toColor", () => {
        test("fromColor with number", () => {
            const color = ThreeHelper.fromColor(0xff0000);
            expect(color.getHex()).toBe(0xff0000);
        });

        test("fromColor with string", () => {
            const color = ThreeHelper.fromColor("#00ff00");
            expect(color.getHex()).toBe(0x00ff00);
        });

        test("toColor returns hex number", () => {
            const color = ThreeHelper.fromColor(0x0000ff);
            const hex = ThreeHelper.toColor(color);
            expect(hex).toBe(0x0000ff);
        });
    });

    describe("findGroupIndex", () => {
        const groups = [
            { start: 0, count: 3 },
            { start: 3, count: 2 },
            { start: 5, count: 4 },
        ];

        test("finds index within first group", () => {
            expect(ThreeHelper.findGroupIndex(groups, 0)).toBe(0);
            expect(ThreeHelper.findGroupIndex(groups, 2)).toBe(0);
        });

        test("finds index within second group", () => {
            expect(ThreeHelper.findGroupIndex(groups, 3)).toBe(1);
            expect(ThreeHelper.findGroupIndex(groups, 4)).toBe(1);
        });

        test("finds index within third group", () => {
            expect(ThreeHelper.findGroupIndex(groups, 5)).toBe(2);
            expect(ThreeHelper.findGroupIndex(groups, 8)).toBe(2);
        });

        test("returns undefined for out-of-range index", () => {
            expect(ThreeHelper.findGroupIndex(groups, 9)).toBeUndefined();
            expect(ThreeHelper.findGroupIndex(groups, -1)).toBeUndefined();
        });

        test("returns undefined for empty groups", () => {
            expect(ThreeHelper.findGroupIndex([], 0)).toBeUndefined();
        });
    });

    describe("transformVector", () => {
        test("identity matrix does not change vector", () => {
            const m = new ThreeMatrix4();
            const v = new Vector3(1, 2, 3);
            const result = ThreeHelper.transformVector(m, v);
            expect(result.x).toBeCloseTo(1);
            expect(result.y).toBeCloseTo(2);
            expect(result.z).toBeCloseTo(3);
        });

        test("translation is NOT applied (only linear part)", () => {
            const m = new ThreeMatrix4();
            m.setPosition(10, 20, 30);
            const v = new Vector3(1, 0, 0);
            const result = ThreeHelper.transformVector(m, v);
            // The method only uses the upper-left 3x3 (rotation/scale part)
            // Position is ignored in transformVector
            expect(result.x).toBeCloseTo(1);
            expect(result.y).toBeCloseTo(0);
            expect(result.z).toBeCloseTo(0);
        });

        test("scale is applied", () => {
            const m = new ThreeMatrix4();
            m.makeScale(2, 3, 4);
            const v = new Vector3(1, 1, 1);
            const result = ThreeHelper.transformVector(m, v);
            expect(result.x).toBeCloseTo(2);
            expect(result.y).toBeCloseTo(3);
            expect(result.z).toBeCloseTo(4);
        });
    });

    describe("boxCorners", () => {
        test("returns 8 corners of a box", () => {
            const min = new Vector3(0, 0, 0);
            const max = new Vector3(1, 2, 3);
            const box = new Box3(min, max);
            const corners = ThreeHelper.boxCorners(box);

            expect(corners.length).toBe(8);
            // Verify first corner is min
            expect(corners[0].x).toBe(0);
            expect(corners[0].y).toBe(0);
            expect(corners[0].z).toBe(0);
            // Verify corner at index 6 is max (the implementation orders as:
            // min, max(x), max(x,y), min(x)+max(y), then +z variants)
            expect(corners[6].x).toBe(1);
            expect(corners[6].y).toBe(2);
            expect(corners[6].z).toBe(3);
        });

        test("corners cover all 8 combinations", () => {
            const min = new Vector3(-1, -2, -3);
            const max = new Vector3(4, 5, 6);
            const box = new Box3(min, max);
            const corners = ThreeHelper.boxCorners(box);

            const hasMinX = corners.some((c) => c.x === -1);
            const hasMaxX = corners.some((c) => c.x === 4);
            const hasMinY = corners.some((c) => c.y === -2);
            const hasMaxY = corners.some((c) => c.y === 5);
            const hasMinZ = corners.some((c) => c.z === -3);
            const hasMaxZ = corners.some((c) => c.z === 6);

            expect(hasMinX).toBe(true);
            expect(hasMaxX).toBe(true);
            expect(hasMinY).toBe(true);
            expect(hasMaxY).toBe(true);
            expect(hasMinZ).toBe(true);
            expect(hasMaxZ).toBe(true);
        });
    });

    describe("getBoundingBox", () => {
        let createdObjects: Mesh[] = [];

        afterEach(() => {
            for (const mesh of createdObjects) {
                mesh.geometry?.dispose();
                (mesh.material as MeshBasicMaterial)?.dispose();
            }
            createdObjects = [];
        });

        test("returns undefined for empty Object3D", () => {
            const obj = new Object3D();
            const result = ThreeHelper.getBoundingBox(obj);
            expect(result).toBeUndefined();
        });

        test("returns bounding box for mesh with geometry", () => {
            const geo = new BufferGeometry();
            const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
            geo.setAttribute("position", new BufferAttribute(positions, 3));
            geo.setIndex([0, 1, 2, 0, 2, 3]);
            geo.computeBoundingBox();
            const mesh = new Mesh(geo, new MeshBasicMaterial());
            createdObjects.push(mesh);

            const result = ThreeHelper.getBoundingBox(mesh);
            expect(result).toBeDefined();
            expect(result!.min.x).toBeCloseTo(-1);
            expect(result!.max.x).toBeCloseTo(1);
        });
    });

    describe("parseToThreeMaterial", () => {
        test("parses PhysicalMaterial to ThreePhysicalMaterial", () => {
            const doc = new TestDocument();
            const coreMaterial = new PhysicalMaterial({
                document: doc,
                name: "test-physical",
                color: 0xff0000,
            });
            coreMaterial.roughness = 0.5;
            coreMaterial.metalness = 0.8;
            coreMaterial.opacity = 0.9;
            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);
            expect(threeMat).toBeDefined();
            expect(threeMat.name).toBe("test-physical");
        });

        test("parses PhongMaterial to ThreePhongMaterial", () => {
            const doc = new TestDocument();
            const coreMaterial = new PhongMaterial({
                document: doc,
                name: "test-phong",
                color: 0x00ff00,
            });
            coreMaterial.shininess = 32;
            coreMaterial.opacity = 0.8;
            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);
            expect(threeMat).toBeDefined();
            expect(threeMat.name).toBe("test-phong");
        });

        test("parses base Material to MeshLambertMaterial", () => {
            const doc = new TestDocument();
            const coreMaterial = new Material({
                document: doc,
                name: "test-basic",
                color: 0x0000ff,
            });
            coreMaterial.opacity = 0.7;
            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);
            expect(threeMat).toBeDefined();
            expect(threeMat.name).toBe("test-basic");
        });
    });

    describe("isPerspectiveCamera / isOrthographicCamera", () => {
        test("isPerspectiveCamera returns true for PerspectiveCamera", () => {
            const cam = new PerspectiveCamera();
            expect(ThreeHelper.isPerspectiveCamera(cam)).toBe(true);
        });

        test("isPerspectiveCamera returns falsy for OrthographicCamera", () => {
            const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
            expect(ThreeHelper.isPerspectiveCamera(cam)).toBeFalsy();
        });

        test("isOrthographicCamera returns true for OrthographicCamera", () => {
            const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
            expect(ThreeHelper.isOrthographicCamera(cam)).toBe(true);
        });

        test("isOrthographicCamera returns falsy for PerspectiveCamera", () => {
            const cam = new PerspectiveCamera();
            expect(ThreeHelper.isOrthographicCamera(cam)).toBeFalsy();
        });
    });
});
