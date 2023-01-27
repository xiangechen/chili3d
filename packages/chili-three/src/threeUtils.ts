// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants, XYZ } from "chili-core";
import {
    BufferAttribute,
    BufferGeometry,
    Camera,
    Float32BufferAttribute,
    OrthographicCamera,
    PerspectiveCamera,
    Vector3,
} from "three";

export class ThreeUtils {
    // static toVertexBuffer(data: VertexsRenderData) {
    //     let buff = new BufferGeometry();
    //     buff.setAttribute("position", new Float32BufferAttribute(data.vertexs.vertexs, 3));
    //     if (data.vertexColors !== undefined)
    //         buff.setAttribute("color", new BufferAttribute(data.vertexColors, 3));
    //     return buff
    // }

    // static toLineBuffer(data: EdgeRenderData) {
    //     let buff = new BufferGeometry();
    //     buff.setAttribute("position", new Float32BufferAttribute(data.vertexs.vertexs, 3));
    //     if (data.vertexColors !== undefined)
    //         buff.setAttribute("color", new BufferAttribute(data.vertexColors, 3));
    //     return buff
    // }

    // static toFaceBuffer(data: FaceRenderData) {
    //     let buff = new BufferGeometry();
    //     buff.setAttribute("position", new Float32BufferAttribute(data.vertexs.vertexs, 3));
    //     buff.setAttribute("normals", new Float32BufferAttribute(data.faceData.normals, 3));
    //     if (data.vertexColors !== undefined)
    //         buff.setAttribute("color", new BufferAttribute(data.vertexColors, 3));
    //     buff.setIndex(data.indices);
    //     return buff
    // }

    static toXYZ(vector: Vector3): XYZ {
        return new XYZ(vector.x, vector.y, vector.z);
    }

    static fromXYZ(vector: XYZ): Vector3 {
        return new Vector3(vector.x, vector.y, vector.z);
    }

    static isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
        return (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    }

    static isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
        return (camera as OrthographicCamera).isOrthographicCamera;
    }
}
