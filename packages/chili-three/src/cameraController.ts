// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICameraController, Point, ShapeType } from "chili-core";
import { Box3, Matrix4, OrthographicCamera, PerspectiveCamera, Sphere, Vector3 } from "three";
import { ThreeHelper } from "./threeHelper";
import { ThreeShape } from "./threeShape";
import { ThreeView } from "./threeView";
import { ThreeVisualContext } from "./threeVisualContext";

const DegRad = Math.PI / 180.0;

export class CameraController implements ICameraController {
    zoomSpeed: number = 0.05;
    rotateSpeed: number = 0.01;
    #up: Vector3 = new Vector3(0, 0, 1);
    #target: Vector3 = new Vector3();
    #position: Vector3 = new Vector3(1500, 1500, 1500);
    #fov: number = 50;
    #rotateCenter: Vector3 | undefined;
    #camera: PerspectiveCamera | OrthographicCamera;

    #cameraType: "perspective" | "orthographic" = "orthographic";
    get cameraType(): "perspective" | "orthographic" {
        return this.#cameraType;
    }
    set cameraType(value: "perspective" | "orthographic") {
        if (this.#cameraType === value) {
            return;
        }
        this.#cameraType = value;
        this.#camera = this.newCamera();
    }

    get target() {
        return this.#target;
    }

    set target(value: Vector3) {
        this.#target.copy(value);
    }

    get camera(): PerspectiveCamera | OrthographicCamera {
        return this.#camera;
    }

    constructor(readonly view: ThreeView) {
        this.#camera = this.newCamera();
    }

    private newCamera() {
        return this.#cameraType === "perspective"
            ? new PerspectiveCamera(this.#fov, 1, 0.0001, 1e6)
            : new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.0001, 1e6);
    }

    pan(dx: number, dy: number): void {
        let ratio = 0.002 * this.#target.distanceTo(this.#position);
        let direction = this.#target.clone().sub(this.#position).normalize();
        let hor = direction.clone().cross(this.#up).normalize();
        let ver = hor.clone().cross(direction).normalize();
        let vector = hor.multiplyScalar(-dx).add(ver.multiplyScalar(dy)).multiplyScalar(ratio);
        this.#target.add(vector);
        this.#position.add(vector);

        this.update();
    }

    update() {
        this.#camera.position.copy(this.#position);
        this.#camera.up.copy(this.#up);
        this.#camera.lookAt(this.#target);

        if (this.#camera instanceof OrthographicCamera) {
            let aspect = this.view.width! / this.view.height!;
            let length = this.#position.distanceTo(this.#target);
            let frustumHalfHeight = length * Math.tan((this.#fov * DegRad) / 2);
            this.#camera.left = -frustumHalfHeight * aspect;
            this.#camera.right = frustumHalfHeight * aspect;
            this.#camera.top = frustumHalfHeight;
            this.#camera.bottom = -frustumHalfHeight;
        }

        this.#camera.updateProjectionMatrix();
    }

    startRotate(x: number, y: number): void {
        let shape = this.view.detected(ShapeType.Shape, x, y).at(0)?.owner;
        if (shape instanceof ThreeShape) {
            this.#rotateCenter = new Vector3();
            let box = new Box3();
            box.setFromObject(shape);
            box.getCenter(this.#rotateCenter);
        } else {
            this.#rotateCenter = undefined;
        }
    }

    rotate(dx: number, dy: number): void {
        let center = this.#rotateCenter ?? this.#target;
        let direction = this.#position.clone().sub(center);
        let hor = this.#up.clone().cross(direction).normalize();
        let matrixX = new Matrix4().makeRotationAxis(hor, -dy * this.rotateSpeed);
        let matrixY = new Matrix4().makeRotationAxis(new Vector3(0, 0, 1), -dx * this.rotateSpeed);
        let matrix = new Matrix4().multiplyMatrices(matrixY, matrixX);
        this.#position = ThreeHelper.transformVector(matrix, direction).add(center);
        if (this.#rotateCenter) {
            let vecTrt = this.#target.clone().sub(this.#camera.position);
            this.#target = ThreeHelper.transformVector(matrix, vecTrt).add(this.#position);
        }

        this.#up.transformDirection(matrix);

        this.update();
    }

    fitContent(): void {
        let context = this.view.viewer.visual.context as ThreeVisualContext;
        let sphere = new Sphere();
        new Box3().setFromObject(context.visualShapes).getBoundingSphere(sphere);

        let fieldOfView = this.#fov / 2.0;
        if (this.view.width! < this.view.height!) {
            fieldOfView = (fieldOfView * this.view.width!) / this.view.height!;
        }
        let distance = sphere.radius / Math.sin(fieldOfView * DegRad);
        let direction = this.#target.clone().sub(this.#position).normalize();

        this.#target.copy(sphere.center);
        this.#position.copy(this.#target.clone().sub(direction.clone().multiplyScalar(distance)));
        this.update();
    }

    zoom(x: number, y: number, delta: number): void {
        let scale = delta > 0 ? this.zoomSpeed : -this.zoomSpeed;
        let direction = this.#target.clone().sub(this.#position);
        let mouse = this.mouseToWorld(x, y);
        if (this.#camera instanceof PerspectiveCamera) {
            let directionNormal = direction.clone().normalize();
            let dot = mouse.clone().sub(this.#position).dot(directionNormal);
            let project = this.#position.clone().add(directionNormal.clone().multiplyScalar(dot));
            let length =
                (project.distanceTo(mouse) * direction.length()) / project.distanceTo(this.#position);
            let v = mouse.clone().sub(project).normalize().multiplyScalar(length);
            mouse = this.#target.clone().add(v);
        }
        let vector = this.#target.clone().sub(mouse).multiplyScalar(scale);

        this.#target.add(vector);
        this.#position.copy(this.#target.clone().sub(direction.clone().multiplyScalar(1 + scale)));

        this.update();
    }

    lookAt(eye: Point, target: Point, up: Point): void {
        this.#position.set(eye.x, eye.y, eye.z);
        this.#target.set(target.x, target.y, target.z);
        this.#up.set(up.x, up.y, up.z);
        this.update();
    }

    private mouseToWorld(mx: number, my: number) {
        let x = (2.0 * mx) / this.view.width! - 1;
        let y = (-2.0 * my) / this.view.height! + 1;
        let dist = this.#position.distanceTo(this.#target);
        let z = (this.#camera.far + this.#camera.near - 2 * dist) / (this.#camera.near - this.#camera.far);

        return new Vector3(x, y, z).unproject(this.#camera);
    }
}
