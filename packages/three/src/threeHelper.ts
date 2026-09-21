// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type Material, MathUtils, Matrix4, type Texture, XYZ } from "@chili3d/core";
import {
    Box3,
    type Camera,
    DoubleSide,
    NoColorSpace,
    type Object3D,
    type OrthographicCamera,
    type PerspectiveCamera,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
    Color as ThreeColor,
    Matrix4 as ThreeMatrix4,
    MeshPhysicalMaterial as ThreePhysicalMaterial,
    Vector2,
    Vector3,
    type Vector3Like,
} from "three";

export class ThreeHelper {
    static toMatrix(matrix: ThreeMatrix4) {
        return Matrix4.fromArray(matrix.toArray());
    }

    static fromMatrix(matrix: Matrix4) {
        return new ThreeMatrix4().fromArray(matrix.toArray());
    }

    static toXYZ(vector: Vector3): XYZ {
        return new XYZ(vector);
    }

    static fromXYZ(vector: Vector3Like): Vector3 {
        return new Vector3(vector.x, vector.y, vector.z);
    }

    static isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
        return (camera as PerspectiveCamera).isPerspectiveCamera;
    }

    static isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
        return (camera as OrthographicCamera).isOrthographicCamera;
    }

    static fromColor(color: number | string): ThreeColor {
        return new ThreeColor(color);
    }

    static toColor(color: ThreeColor): number {
        return color.getHex();
    }

    static findGroupIndex(groups: { start: number; count: number }[], subIndex: number) {
        for (let i = 0; i < groups.length; i++) {
            if (subIndex >= groups[i].start && subIndex < groups[i].start + groups[i].count) {
                return i;
            }
        }
        return undefined;
    }

    static transformVector(matrix: ThreeMatrix4, vector: Vector3) {
        const array = matrix.elements;
        const x = vector.x * array[0] + vector.y * array[4] + vector.z * array[8];
        const y = vector.x * array[1] + vector.y * array[5] + vector.z * array[9];
        const z = vector.x * array[2] + vector.y * array[6] + vector.z * array[10];
        return new Vector3(x, y, z);
    }

    static getBoundingBox(object: Object3D) {
        const box = new Box3();
        box.setFromObject(object);
        if (box.isEmpty()) {
            return undefined;
        }
        return { min: ThreeHelper.toXYZ(box.min), max: ThreeHelper.toXYZ(box.max) };
    }

    static boxCorners(box: Box3) {
        const min = box.min;
        const max = box.max;
        return [
            new Vector3(min.x, min.y, min.z),
            new Vector3(max.x, min.y, min.z),
            new Vector3(max.x, max.y, min.z),
            new Vector3(min.x, max.y, min.z),
            new Vector3(min.x, min.y, max.z),
            new Vector3(max.x, min.y, max.z),
            new Vector3(max.x, max.y, max.z),
            new Vector3(min.x, max.y, max.z),
        ];
    }

    /**
     * `slot` is the material property the image goes into, which is what decides its colour space:
     * `map` and `emissiveMap` hold colour and are authored in sRGB, while roughness, metalness,
     * normal and bump carry data — decoding those as sRGB would bend the values the shader reads.
     */
    static loadTexture(item: Texture | undefined, slot: string) {
        if (!item?.image) {
            return null;
        }

        const map = new TextureLoader().load(item.image);
        map.colorSpace = colorMapSlots.has(slot) ? SRGBColorSpace : NoColorSpace;
        map.wrapS = RepeatWrapping;
        map.wrapT = RepeatWrapping;
        map.center.set(0.5, 0.5);
        map.offset.set(item.offset.x, item.offset.y);
        map.repeat.set(item.repeat.x, item.repeat.y);
        map.rotation = MathUtils.degToRad(item.rotation);
        return map;
    }

    static parseToThreeMaterial(material: Material) {
        return new ThreePhysicalMaterial({
            color: material.color,
            side: DoubleSide,
            transparent: material.opacity < 1,
            name: material.name,
            opacity: material.opacity,
            map: ThreeHelper.loadTexture(material.map, "map"),
            roughness: material.roughness,
            roughnessMap: ThreeHelper.loadTexture(material.roughnessMap, "roughnessMap"),
            metalness: material.metalness,
            metalnessMap: ThreeHelper.loadTexture(material.metalnessMap, "metalnessMap"),
            normalMap: ThreeHelper.loadTexture(material.normalMap, "normalMap"),
            normalScale: new Vector2(material.normalScale.x, material.normalScale.y),
            bumpMap: ThreeHelper.loadTexture(material.bumpMap, "bumpMap"),
            bumpScale: material.bumpScale,
            emissive: ThreeHelper.fromColor(material.emissive),
            emissiveIntensity: material.emissiveIntensity,
            emissiveMap: ThreeHelper.loadTexture(material.emissiveMap, "emissiveMap"),
        });
    }
}

/** The material slots whose image is colour; every other slot carries data. */
const colorMapSlots: ReadonlySet<string> = new Set(["map", "emissiveMap"]);
