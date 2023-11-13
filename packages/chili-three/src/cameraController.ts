// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICameraController, ShapeType, XYZ } from "chili-core";
import {
    Box3,
    Line3,
    Matrix4,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Plane,
    Vector3,
} from "three";
import { ThreeHelper } from "./threeHelper";
import { ThreeShape } from "./threeShape";
import { ThreeView } from "./threeView";
import { ThreeVisualContext } from "./threeVisualContext";

export class CameraController implements ICameraController {
    zoomSpeed: number = 0.1;
    rotateSpeed: number = 0.01;
    #target: Vector3 = new Vector3();
    #rotateStart: Vector3 | undefined;
    readonly #perspectiveCamera: PerspectiveCamera;
    readonly #orthographic: OrthographicCamera;

    #cameraType: "perspective" | "orthographic" = "perspective";
    get cameraType(): "perspective" | "orthographic" {
        return this.#cameraType;
    }
    set cameraType(value: "perspective" | "orthographic") {
        if (this.#cameraType === value) {
            return;
        }
        this.#cameraType = value;
        if (value === "perspective") {
            this.updateCamera(this.#orthographic.position, this.#target, false);
        } else {
            this.updateCamera(this.#perspectiveCamera.position, this.#target, false);
        }
    }

    get scale() {
        return this.#orthographic.zoom;
    }

    get camera(): PerspectiveCamera | OrthographicCamera {
        return this.cameraType === "perspective" ? this.#perspectiveCamera : this.#orthographic;
    }

    constructor(readonly view: ThreeView) {
        this.#perspectiveCamera = this.initPerspectiveCamera(view.container);
        this.#orthographic = this.initOrthographicCamera(view.container);
    }

    private initPerspectiveCamera(container: HTMLElement) {
        let k = container.clientWidth / container.clientHeight;
        let camera = new PerspectiveCamera(45, k, 0.001, 1e12);
        this.initCamera(camera);
        return camera;
    }

    private initOrthographicCamera(container: HTMLElement) {
        let camera = new OrthographicCamera(
            -container.clientWidth * 0.5,
            container.clientWidth * 0.5,
            container.clientHeight * 0.5,
            -container.clientHeight * 0.5,
            1,
            1e12,
        );
        this.initCamera(camera);
        return camera;
    }

    private initCamera(camera: PerspectiveCamera | OrthographicCamera) {
        camera.position.set(1500, 1500, 1500);
        camera.lookAt(new Vector3());
        camera.updateMatrixWorld(true);
        return camera;
    }

    pan(dx: number, dy: number): void {
        let { x, y } = this.view.worldToScreen(ThreeHelper.toXYZ(this.#target));
        let plane = this.cameraPlane(this.#target);
        let p1 = this.planeIntersectCameraLineByMouse(x, y, plane);
        let p2 = this.planeIntersectCameraLineByMouse(x - dx, y - dy, plane);
        let vec = p2.sub(p1);
        this.updateCamera(this.camera.position.add(vec), this.#target.add(vec));
    }

    private updateCamera(position: Vector3, target: Vector3, setTarget: boolean = true) {
        if (setTarget) this.#target.copy(target);
        this.camera.position.copy(position);
        this.camera.lookAt(this.#target);
        this.camera.updateProjectionMatrix();
    }

    private planeIntersectCameraLineByMouse(x: number, y: number, plane: Plane) {
        let position = this.mouseToWorld(x, y);
        return this.planeIntersectCameraLine(plane, position);
    }

    private planeIntersectCameraLine(plane: Plane, position: Vector3) {
        let line = this.getCameraLine(position);
        let point = new Vector3();
        if (!plane.intersectLine(line, point)) {
            throw new Error("Could not find intersection with plane");
        }
        return point;
    }

    private getCameraLine(position: Vector3) {
        let vec = new Vector3();
        if (this.camera instanceof PerspectiveCamera) {
            vec = this.camera.position.clone().sub(position).normalize();
        } else {
            this.camera.getWorldDirection(vec);
        }
        vec.multiplyScalar(1e19);
        return new Line3(position, position.clone().sub(vec));
    }

    private cameraPlane(position: Vector3) {
        let direction = new Vector3();
        this.camera.getWorldDirection(direction);
        let distance = position.dot(direction);
        return new Plane(direction, distance);
    }

    startRotate(x: number, y: number): void {
        let shape = this.view.detected(ShapeType.Shape, x, y).at(0)?.owner;
        if (shape instanceof ThreeShape) {
            this.#rotateStart = new Vector3();
            let box = new Box3();
            box.setFromObject(shape);
            box.getCenter(this.#rotateStart);
        } else {
            this.#rotateStart = undefined;
        }
    }

    rotate(dx: number, dy: number): void {
        let start = this.#rotateStart ?? this.#target;
        let vecPos = this.camera.position.clone().sub(start);
        let xvec = this.camera.up.clone().cross(vecPos).normalize();
        let yvec = new Vector3(0, 0, 1);
        let matrixX = new Matrix4().makeRotationAxis(xvec, -dy * this.rotateSpeed);
        let matrixY = new Matrix4().makeRotationAxis(yvec, -dx * this.rotateSpeed);
        let matrix = new Matrix4().multiplyMatrices(matrixY, matrixX);
        let position = ThreeHelper.transformVector(matrix, vecPos).add(start);
        if (this.#rotateStart) {
            let vecTrt = this.#target.clone().sub(this.camera.position);
            this.#target = ThreeHelper.transformVector(matrix, vecTrt).add(position);
        }
        this.camera.up.copy(this.camera.up.transformDirection(matrix));
        this.updateCamera(position, this.#target, false);
    }

    fitContent(): void {
        let context = this.view.viewer.visual.context as ThreeVisualContext;
        let vectors = ThreeHelper.cameraVectors(this.camera);
        let rect = this.cameraRect(context.visualShapes, vectors.right, vectors.up);
        if (!rect.width || !rect.height) return;
        let h = Math.max(rect.width / this.#perspectiveCamera.aspect, rect.height);
        let distance = (0.5 * h) / Math.tan((this.#perspectiveCamera.fov * Math.PI) / 180 / 2.0);
        let position = rect.center.clone().sub(vectors.direction.clone().multiplyScalar(distance));
        this.#orthographic.zoom = Math.min(
            this.view.container.clientWidth / rect.width,
            this.view.container.clientHeight / rect.height,
        );
        this.updateCamera(position, rect.center);
    }

    private cameraRect(object: Object3D, right: Vector3, up: Vector3) {
        let box = this.getSceneBox(object);
        let [minV, maxV, minH, maxH] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const point of box.points) {
            let dotV = point.dot(up);
            let dotH = point.dot(right);
            minV = Math.min(minV, dotV);
            maxV = Math.max(maxV, dotV);
            minH = Math.min(minH, dotH);
            maxH = Math.max(maxH, dotH);
        }
        let center = new Vector3()
            .add(right.clone().multiplyScalar((minH + maxH) * 0.5))
            .add(up.clone().multiplyScalar((minV + maxV) * 0.5));
        return {
            center,
            width: maxH - minH,
            height: maxV - minV,
        };
    }

    private getSceneBox(shape: Object3D) {
        let [box, center] = [new Box3(), new Vector3()];
        box.setFromObject(shape);
        box.getCenter(center);
        return {
            center,
            points: ThreeHelper.boxCorners(box),
        };
    }

    zoom(x: number, y: number, delta: number): void {
        this.#orthographic.zoom *= delta > 0 ? 1 + this.zoomSpeed : 1 - this.zoomSpeed;
        let point = this.mouseToWorld(x, y);
        let cameraVectors = ThreeHelper.cameraVectors(this.camera);
        let scale = delta > 0 ? this.zoomSpeed : -this.zoomSpeed;
        let vec: Vector3;
        if (this.#cameraType === "orthographic") {
            vec = point.clone().sub(this.#target);
        } else {
            vec = this.camera.position.clone().sub(point);
            let angle = vec.angleTo(cameraVectors.direction);
            let length = this.camera.position.distanceTo(this.#target);
            vec.setLength(length / Math.cos(angle));
        }
        let dx = vec.clone().dot(cameraVectors.right) * scale;
        let dy = vec.clone().dot(cameraVectors.up) * scale;
        let dz = this.camera.position.distanceTo(this.#target) * scale;
        let moveVector = new Vector3()
            .add(cameraVectors.right.clone().multiplyScalar(dx))
            .add(cameraVectors.up.clone().multiplyScalar(dy));
        this.#target.add(moveVector);
        moveVector.add(cameraVectors.direction.clone().multiplyScalar(dz));
        this.updateCamera(this.camera.position.add(moveVector), this.#target, false);
    }

    lookAt(eye: XYZ, target: XYZ): void {
        this.updateCamera(ThreeHelper.fromXYZ(eye), ThreeHelper.fromXYZ(target));
    }

    private mouseToWorld(mx: number, my: number) {
        let x = (2.0 * mx) / this.view.container.clientWidth - 1;
        let y = (-2.0 * my) / this.view.container.clientHeight + 1;
        return new Vector3(x, y, 0).unproject(this.camera);
    }
}
