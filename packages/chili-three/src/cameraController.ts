// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICameraController, IModel, INode, Point, ShapeType } from "chili-core";
import { Box3, Matrix4, OrthographicCamera, PerspectiveCamera, Sphere, Vector3 } from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import { ThreeView } from "./threeView";
import { ThreeVisualContext } from "./threeVisualContext";

const DegRad = Math.PI / 180.0;

export class CameraController implements ICameraController {
    zoomSpeed: number = 0.05;
    rotateSpeed: number = 0.01;
    private _up: Vector3 = new Vector3(0, 0, 1);
    private _target: Vector3 = new Vector3();
    private _position: Vector3 = new Vector3(1500, 1500, 1500);
    private _fov: number = 50;
    private _rotateCenter: Vector3 | undefined;
    private _camera: PerspectiveCamera | OrthographicCamera;

    private _cameraType: "perspective" | "orthographic" = "orthographic";
    get cameraType(): "perspective" | "orthographic" {
        return this._cameraType;
    }
    set cameraType(value: "perspective" | "orthographic") {
        if (this._cameraType === value) {
            return;
        }
        this._cameraType = value;
        this._camera = this.newCamera();
    }

    get target() {
        return this._target;
    }

    set target(value: Vector3) {
        this._target.copy(value);
    }

    get camera(): PerspectiveCamera | OrthographicCamera {
        return this._camera;
    }

    constructor(readonly view: ThreeView) {
        this._camera = this.newCamera();
    }

    private newCamera() {
        return this._cameraType === "perspective"
            ? new PerspectiveCamera(this._fov, 1, 0.1, 1e4)
            : new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 1e4);
    }

    pan(dx: number, dy: number): void {
        let ratio = 0.0015 * this._target.distanceTo(this._position);
        let direction = this._target.clone().sub(this._position).normalize();
        let hor = direction.clone().cross(this._up).normalize();
        let ver = hor.clone().cross(direction).normalize();
        let vector = hor.multiplyScalar(-dx).add(ver.multiplyScalar(dy)).multiplyScalar(ratio);
        this._target.add(vector);
        this._position.add(vector);

        this.update();
    }

    update() {
        this._camera.position.copy(this._position);
        this._camera.up.copy(this._up);
        this._camera.lookAt(this._target);
        if (this._camera instanceof OrthographicCamera) {
            this.updateOrthographicCamera(this._camera);
        }

        this._camera.updateProjectionMatrix();
    }

    private updateOrthographicCamera(camera: OrthographicCamera) {
        let aspect = this.view.width! / this.view.height!;
        let length = this._position.distanceTo(this._target);
        let frustumHalfHeight = length * Math.tan((this._fov * DegRad) / 2);
        camera.left = -frustumHalfHeight * aspect;
        camera.right = frustumHalfHeight * aspect;
        camera.top = frustumHalfHeight;
        camera.bottom = -frustumHalfHeight;
    }

    startRotate(x: number, y: number): void {
        let shape = this.view.detected(ShapeType.Shape, x, y).at(0)?.owner;
        if (!(shape instanceof ThreeGeometry)) {
            this._rotateCenter = undefined;
            return;
        }
        this._rotateCenter = new Vector3();
        let box = new Box3();
        box.setFromObject(shape);
        box.getCenter(this._rotateCenter);
    }

    rotate(dx: number, dy: number): void {
        let center = this._rotateCenter ?? this._target;
        let direction = this._position.clone().sub(center);
        let hor = this._up.clone().cross(direction).normalize();
        let matrixX = new Matrix4().makeRotationAxis(hor, -dy * this.rotateSpeed);
        let matrixY = new Matrix4().makeRotationAxis(new Vector3(0, 0, 1), -dx * this.rotateSpeed);
        let matrix = new Matrix4().multiplyMatrices(matrixY, matrixX);
        this._position = ThreeHelper.transformVector(matrix, direction).add(center);
        if (this._rotateCenter) {
            let targetToEye = this._target.clone().sub(this._camera.position);
            this._target = ThreeHelper.transformVector(matrix, targetToEye).add(this._position);
        }

        this._up.transformDirection(matrix);

        this.update();
    }

    fitContent(): void {
        let context = this.view.document.visual.context as ThreeVisualContext;
        let sphere = this.getBoundingSphere(context);
        let fieldOfView = this._fov / 2.0;
        if (this.view.width! < this.view.height!) {
            fieldOfView = (fieldOfView * this.view.width!) / this.view.height!;
        }
        let distance = sphere.radius / Math.sin(fieldOfView * DegRad);
        let direction = this._target.clone().sub(this._position).normalize();

        this._target.copy(sphere.center);
        this._position.copy(this._target.clone().sub(direction.clone().multiplyScalar(distance)));
        this.updateCameraNearFar();
        this.update();
    }

    private getBoundingSphere(context: ThreeVisualContext) {
        let sphere = new Sphere();
        let shapes = this.view.document.selection.getSelectedNodes().filter((x) => INode.isModelNode(x));
        if (shapes.length === 0) {
            new Box3().setFromObject(context.visualShapes).getBoundingSphere(sphere);
            return sphere;
        }

        let box = new Box3();
        for (let shape of shapes) {
            let threeGeometry = context.getShape(shape) as ThreeGeometry;
            let boundingBox = new Box3().setFromObject(threeGeometry);
            if (boundingBox) {
                box.union(boundingBox);
            }
        }
        box.getBoundingSphere(sphere);
        return sphere;
    }

    zoom(x: number, y: number, delta: number): void {
        let scale = delta > 0 ? this.zoomSpeed : -this.zoomSpeed;
        let direction = this._target.clone().sub(this._position);
        let mouse = this.mouseToWorld(x, y);
        if (this._camera instanceof PerspectiveCamera) {
            mouse = this.caculePerspectiveCameraMouse(direction, mouse);
        }
        let vector = this._target.clone().sub(mouse).multiplyScalar(scale);
        this._target.add(vector);
        this._position.copy(this._target.clone().sub(direction.clone().multiplyScalar(1 + scale)));

        this.updateTarget(direction);
        this.updateCameraNearFar();

        this.update();
    }

    private updateTarget(vector: Vector3) {
        let direction = vector.clone().normalize();
        let sphere = this.getBoundingSphere(this.view.document.visual.context as ThreeVisualContext);
        let length = sphere.center.sub(this._position).dot(direction);
        this._target.copy(this._position.clone().add(direction.multiplyScalar(length)));
    }

    private updateCameraNearFar() {
        let distance = this._position.distanceTo(this._target);
        if (distance < 1000.0) {
            this.camera.near = 0.1;
            this.camera.far = 10000.0;
        } else if (distance < 100000.0) {
            this.camera.near = 10;
            this.camera.far = 1000000.0;
        } else if (distance < 1000000.0) {
            this.camera.near = 1000.0;
            this.camera.far = 10000000.0;
        } else {
            this.camera.near = 10000.0;
            this.camera.far = 100000000.0;
        }
    }

    private caculePerspectiveCameraMouse(direction: Vector3, mouse: Vector3) {
        let directionNormal = direction.clone().normalize();
        let dot = mouse.clone().sub(this._position).dot(directionNormal);
        let project = this._position.clone().add(directionNormal.clone().multiplyScalar(dot));
        let length = (project.distanceTo(mouse) * direction.length()) / project.distanceTo(this._position);
        let v = mouse.clone().sub(project).normalize().multiplyScalar(length);
        mouse = this._target.clone().add(v);
        return mouse;
    }

    lookAt(eye: Point, target: Point, up: Point): void {
        this._position.set(eye.x, eye.y, eye.z);
        this._target.set(target.x, target.y, target.z);
        this._up.set(up.x, up.y, up.z);
        this.update();
    }

    private mouseToWorld(mx: number, my: number) {
        let x = (2.0 * mx) / this.view.width! - 1;
        let y = (-2.0 * my) / this.view.height! + 1;
        let dist = this._position.distanceTo(this._target);
        let z = (this._camera.far + this._camera.near - 2 * dist) / (this._camera.near - this._camera.far);

        return new Vector3(x, y, z).unproject(this._camera);
    }
}
