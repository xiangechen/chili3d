// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Material, Matrix4, XY, XYZ } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Matrix4 as ThreeMatrix4,
    Vector3,
} from "three";
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

        test.each([
            ["first group start", groups, 0, 0],
            ["first group end", groups, 2, 0],
            ["second group start", groups, 3, 1],
            ["second group end", groups, 4, 1],
            ["third group start", groups, 5, 2],
            ["third group end", groups, 8, 2],
            ["out-of-range index", groups, 9, undefined],
            ["negative index", groups, -1, undefined],
            ["empty groups", [] as { start: number; count: number }[], 0, undefined],
        ])("returns %s", (_name, g, index, expected) => {
            expect(ThreeHelper.findGroupIndex(g, index)).toBe(expected);
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
            expect(result).not.toBeUndefined();
            expect(result!.min.x).toBeCloseTo(-1);
            expect(result!.max.x).toBeCloseTo(1);
        });
    });

    describe("parseToThreeMaterial", () => {
        test("carries the physically based properties onto a MeshPhysicalMaterial", () => {
            const doc = new TestDocument();
            const coreMaterial = new Material({
                document: doc,
                name: "test-physical",
                color: 0xff0000,
            });
            coreMaterial.roughness = 0.5;
            coreMaterial.metalness = 0.8;
            coreMaterial.opacity = 0.9;
            coreMaterial.bumpScale = 2;
            coreMaterial.emissive = 0x00ff00;
            coreMaterial.emissiveIntensity = 3;
            coreMaterial.normalScale = new XY({ x: 2, y: 3 });

            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);

            expect(threeMat).toBeInstanceOf(MeshPhysicalMaterial);
            expect(threeMat.name).toBe("test-physical");
            expect(threeMat.roughness).toBe(0.5);
            expect(threeMat.metalness).toBe(0.8);
            expect(threeMat.opacity).toBe(0.9);
            expect(threeMat.transparent).toBe(true);
            expect(threeMat.bumpScale).toBe(2);
            expect(threeMat.emissive.getHex()).toBe(0x00ff00);
            expect(threeMat.emissiveIntensity).toBe(3);
            expect(threeMat.normalScale.x).toBe(2);
            expect(threeMat.normalScale.y).toBe(3);
        });

        test("treats an opaque material as opaque", () => {
            const doc = new TestDocument();
            const coreMaterial = new Material({ document: doc, name: "opaque", color: 0xff0000 });

            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);

            expect(threeMat.opacity).toBe(1);
            expect(threeMat.transparent).toBe(false);
        });

        test("gives color maps an sRGB colour space and data maps a linear one", () => {
            const doc = new TestDocument();
            const coreMaterial = new Material({ document: doc, name: "textured", color: 0xff0000 });
            coreMaterial.map.image = "data:image/png;base64,AAAA";
            coreMaterial.normalMap.image = "data:image/png;base64,BBBB";

            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);

            expect(threeMat.map?.colorSpace).toBe("srgb");
            expect(threeMat.normalMap?.colorSpace).toBe("");
        });

        test("carries the texture offset", () => {
            const doc = new TestDocument();
            const coreMaterial = new Material({ document: doc, name: "offset", color: 0xff0000 });
            coreMaterial.map.image = "data:image/png;base64,AAAA";
            coreMaterial.map.offset = new XY({ x: 0.25, y: 0.5 });
            coreMaterial.map.repeat = new XY({ x: 2, y: 3 });

            const threeMat = ThreeHelper.parseToThreeMaterial(coreMaterial);

            expect(threeMat.map?.offset.x).toBe(0.25);
            expect(threeMat.map?.offset.y).toBe(0.5);
            expect(threeMat.map?.repeat.x).toBe(2);
            expect(threeMat.map?.repeat.y).toBe(3);
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
