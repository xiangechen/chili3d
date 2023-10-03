// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { ICameraController, XYZ } from "chili-core";
import { Box3, Group, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { ThreeHelper } from "./threeHelper";

export class CameraController implements ICameraController {
    private _target: Vector3 = new Vector3();
    _camera: OrthographicCamera | PerspectiveCamera;

    panSpeed: number = 0.5;
    zoomSpeed: number = 0.9;
    rotateSpeed: number = 0.01;

    constructor(
        camera: OrthographicCamera | PerspectiveCamera,
        readonly dom: HTMLElement,
        readonly shapes: Group,
    ) {
        this._camera = camera;
    }

    setCamera(camera: OrthographicCamera | PerspectiveCamera) {
        this._camera = camera;
    }

    startRotation(dx: number, dy: number): void {}

    pan(dx: number, dy: number): void {
        dx = (dx * this.panSpeed) / this._camera.zoom;
        dy = (dy * this.panSpeed) / this._camera.zoom;
        let x = 0,
            y = 0;
        if (ThreeHelper.isPerspectiveCamera(this._camera)) {
            let distance = this._camera.position.distanceTo(this._target);
            distance *= this.fovTan(this._camera.fov);
            x = (2 * dx * distance) / this.dom.clientHeight;
            y = (2 * dy * distance) / this.dom.clientHeight;
        } else if (ThreeHelper.isOrthographicCamera(this._camera)) {
            let width = this._camera.right - this._camera.left;
            let height = this._camera.top - this._camera.bottom;
            x = (dx * width) / this.dom.clientWidth / this._camera.zoom;
            y = (dy * height) / this.dom.clientHeight / this._camera.zoom;
        }
        this.move(x, y);
    }

    rotate(dx: number, dy: number): void {
        const rotationX = dx * this.rotateSpeed;
        const rotationY = dy * this.rotateSpeed;
        const quaternionX = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotationX);
        const quaternionY = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rotationY);
        const position = this._camera.position
            .clone()
            .sub(this._target)
            .applyQuaternion(quaternionX)
            .applyQuaternion(quaternionY)
            .add(this._target);
        this._camera.position.copy(position);
        this._camera.lookAt(this._target);
    }

    fitContent(): void {
        let box = new Box3();
        box.setFromObject(this.shapes);
        let size = new Vector3(),
            center = new Vector3();
        box.getSize(size);
        box.getCenter(center);
        let normal = this._camera.position.clone().sub(this._target).normalize();
        if (this._camera instanceof PerspectiveCamera) {
            const fov = this._camera.fov * (Math.PI / 180);
            const fovh = 2 * Math.atan(Math.tan(fov / 2) * this._camera.aspect);
            let dx = size.z / 2 + Math.abs(size.x / 2 / Math.tan(fovh / 2));
            let dy = size.z / 2 + Math.abs(size.y / 2 / Math.tan(fov / 2));
            let cameraZ = Math.max(dx, dy);
            let position = center.clone().add(normal.clone().multiplyScalar(cameraZ));
            this._camera.position.set(position.x, position.y, position.z);
            this._camera.lookAt(center);
            this._camera.updateProjectionMatrix();
        }
    }

    zoom(x: number, y: number, delta: number): void {
        let scale = delta > 0 ? this.zoomSpeed : 1 / this.zoomSpeed;
        this._camera.zoom /= scale;
        let point = this.mouseToWorld(x, y);
        if (ThreeHelper.isOrthographicCamera(this._camera)) {
            this.zoomOrthographicCamera(point, scale);
        } else if (ThreeHelper.isPerspectiveCamera(this._camera)) {
            this.zoomPerspectiveCamera(point, scale);
        }
        this._camera.updateProjectionMatrix();
    }

    private zoomOrthographicCamera(point: Vector3, scale: number) {
        let vec = point.clone().sub(this._target);
        let xvec = new Vector3().setFromMatrixColumn(this._camera.matrix, 0);
        let yvec = new Vector3().setFromMatrixColumn(this._camera.matrix, 1);
        let x = vec.clone().dot(xvec);
        let y = vec.clone().dot(yvec);
        let aDxv = x / scale;
        let aDyv = y / scale;
        this.move(aDxv - x, aDyv - y);
    }

    private zoomPerspectiveCamera(point: Vector3, scale: number) {
        let direction = this._camera.position.clone().sub(this._target);
        let vector = this._camera.position.clone().sub(point).normalize();
        let angle = vector.angleTo(direction);
        let length = direction.length() * (scale - 1);
        let moveVector = vector.clone().multiplyScalar(length / Math.cos(angle));
        this._camera.position.add(moveVector);
        this._target.add(moveVector.sub(direction.clone().setLength(length)));
        this._camera.lookAt(this._target);
    }

    lookAt(eye: XYZ, target: XYZ): void {
        this._target.set(target.x, target.y, target.z);
        this._camera.position.set(eye.x, eye.y, eye.z);
        this._camera.lookAt(this._target);
        this._camera.updateMatrixWorld(true);
    }

    private fovTan(fov: number) {
        return Math.tan((fov * 0.5 * Math.PI) / 180.0);
    }

    private mouseToWorld(mx: number, my: number) {
        let x = (mx / this.dom.clientWidth) * 2 - 1;
        let y = -(my / this.dom.clientHeight) * 2 + 1;
        return new Vector3(x, y, 0).unproject(this._camera);
    }

    private move(dx: number, dy: number) {
        let vx = new Vector3().setFromMatrixColumn(this._camera.matrix, 0).multiplyScalar(dx);
        let vy = new Vector3().setFromMatrixColumn(this._camera.matrix, 1).multiplyScalar(dy);
        let vector = new Vector3().add(vx).add(vy);
        this._target.add(vector);
        this._camera.position.add(vector);
        this._camera.lookAt(this._target);
    }
}
