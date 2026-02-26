// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Material,
    MathUtils,
    Matrix4,
    PhongMaterial,
    PhysicalMaterial,
    type Texture,
    XYZ,
} from "chili-core";
import {
    Box3,
    type Camera,
    DoubleSide,
    type Object3D,
    type OrthographicCamera,
    type PerspectiveCamera,
    RepeatWrapping,
    TextureLoader,
    Color as ThreeColor,
    MeshLambertMaterial as ThreeLambertMaterial,
    Matrix4 as ThreeMatrix4,
    MeshPhongMaterial as ThreePhoneMaterial,
    MeshPhysicalMaterial as ThreePhysicalMaterial,
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
        return new XYZ(vector.x, vector.y, vector.z);
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

    static loadTexture(item: Texture | undefined) {
        if (!item?.image) {
            return null;
        }

        const map = new TextureLoader().load(item.image);
        map.wrapS = RepeatWrapping;
        map.wrapT = RepeatWrapping;
        map.center.set(0.5, 0.5);
        map.repeat.set(item.repeat.x, item.repeat.y);
        map.rotation = MathUtils.degToRad(item.rotation);
        return map;
    }

    static parsePhysicalMaterial(material: PhysicalMaterial) {
        return new ThreePhysicalMaterial({
            color: material.color,
            side: DoubleSide,
            transparent: true,
            name: material.name,
            opacity: material.opacity,
            map: ThreeHelper.loadTexture(material.map),
            roughness: material.roughness,
            metalness: material.metalness,
            bumpMap: ThreeHelper.loadTexture(material.bumpMap),
            normalMap: ThreeHelper.loadTexture(material.normalMap),
            emissiveMap: ThreeHelper.loadTexture(material.emissiveMap),
            roughnessMap: ThreeHelper.loadTexture(material.roughnessMap),
            metalnessMap: ThreeHelper.loadTexture(material.metalnessMap),
        });
    }

    static parsePhongMaterial(material: PhongMaterial) {
        return new ThreePhoneMaterial({
            color: material.color,
            side: DoubleSide,
            transparent: true,
            name: material.name,
            opacity: material.opacity,
            map: ThreeHelper.loadTexture(material.map),
            specularMap: ThreeHelper.loadTexture(material.specularMap),
            shininess: material.shininess,
            emissive: ThreeHelper.fromColor(material.emissive),
            emissiveMap: ThreeHelper.loadTexture(material.emissiveMap),
        });
    }

    static parseBasicMaterial(material: Material) {
        return new ThreeLambertMaterial({
            color: material.color,
            side: DoubleSide,
            transparent: true,
            name: material.name,
            opacity: material.opacity,
            map: ThreeHelper.loadTexture(material.map),
        });
    }

    static parseToThreeMaterial(material: Material) {
        if (material instanceof PhysicalMaterial) {
            return ThreeHelper.parsePhysicalMaterial(material);
        }

        if (material instanceof PhongMaterial) {
            return ThreeHelper.parsePhongMaterial(material);
        }

        return ThreeHelper.parseBasicMaterial(material);
    }
}
