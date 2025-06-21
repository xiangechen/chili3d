// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CameraType,
    ICameraController,
    Observable,
    Precision,
    ViewMode,
    VisualNode,
    XYZLike,
} from "chili-core";
import {
    Box3,
    Camera,
    Matrix4,
    OrthographicCamera,
    PerspectiveCamera,
    Raycaster,
    Sphere,
    Vector3,
} from "three";
import { Constants } from "./constants";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import { ThreeView } from "./threeView";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";

const DEG_TO_RAD = Math.PI / 180.0;
const ZOOM_SPEED_FACTOR = 0.1;
const ROTATE_SPEED = 0.01;
const PAN_SPEED_FACTOR = 0.002;
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1e6;
const MAX_PITCH_ANGLE = 88 * DEG_TO_RAD;
const MIN_CARME_TO_TARGET = 100;

Camera.DEFAULT_UP = new Vector3(0, 0, 1);

export class CameraController extends Observable implements ICameraController {
    private _width: number = 100;
    private _height: number = 100;
    private _target: Vector3 = new Vector3();
    private _position: Vector3 = new Vector3(1500, 1500, 1500);
    private _rotateCenter: Vector3 | undefined;
    private _camera: PerspectiveCamera | OrthographicCamera;

    get cameraType(): CameraType {
        return this.getPrivateValue("cameraType", "perspective");
    }
    set cameraType(value: CameraType) {
        if (this.setProperty("cameraType", value)) {
            this._camera = this.createCamera(this._camera.near, this._camera.far);
            if (this.camera instanceof OrthographicCamera) {
                this.updateOrthographicCamera(this.camera);
            }
            this.updateCameraPosionTarget();
        }
    }

    get target() {
        return this._target;
    }

    set target(value: Vector3) {
        this._target.copy(value);
    }

    get cameraPosition() {
        return ThreeHelper.toXYZ(this._position);
    }

    get cameraTarget() {
        return ThreeHelper.toXYZ(this._target);
    }

    get cameraUp() {
        return ThreeHelper.toXYZ(this._camera.up);
    }

    get camera(): PerspectiveCamera | OrthographicCamera {
        return this._camera;
    }

    constructor(readonly view: ThreeView) {
        super();
        this._camera = this.createCamera(CAMERA_NEAR, CAMERA_FAR);
    }

    private createCamera(near: number, far: number) {
        let camera: PerspectiveCamera | OrthographicCamera;
        if (this.cameraType === "perspective") {
            camera = new PerspectiveCamera(CAMERA_FOV, this._width / this._height, near, far);
        } else {
            camera = new OrthographicCamera(
                -this._width / 2,
                this._width / 2,
                this._height / 2,
                -this._height / 2,
                near,
                far,
            );
        }
        this.setCameraLayer(camera, this.view.mode);
        return camera;
    }

    setCameraLayer(camera: Camera, mode: ViewMode) {
        if (mode === ViewMode.wireframe) {
            camera.layers.enable(Constants.Layers.Wireframe);
            camera.layers.disable(Constants.Layers.Solid);
        } else if (mode === ViewMode.solid) {
            camera.layers.enable(Constants.Layers.Solid);
            camera.layers.disable(Constants.Layers.Wireframe);
        } else {
            camera.layers.enableAll();
        }
    }

    pan(dx: number, dy: number): void {
        const ratio = PAN_SPEED_FACTOR * this._target.distanceTo(this._position);
        const direction = this._target.clone().sub(this._position).normalize();
        const hor = direction.clone().cross(this.camera.up).normalize();
        const ver = hor.clone().cross(direction).normalize();
        const vector = hor.multiplyScalar(-dx).add(ver.multiplyScalar(dy)).multiplyScalar(ratio);
        this._target.add(vector);
        this._position.add(vector);

        this.updateCameraPosionTarget();
    }

    updateCameraPosionTarget() {
        const direction = this._target.clone().sub(this._position).normalize();
        if (1 - Math.abs(direction.z) < Precision.Float) {
            this._camera.up.set(0, 1, 0);
        } else {
            this._camera.up.copy(Camera.DEFAULT_UP);
        }

        this._camera.position.copy(this._position);
        this._camera.lookAt(this._target);
        this._camera.updateProjectionMatrix();
    }

    setSize(width: number, height: number): void {
        this._width = width;
        this._height = height;
        if (this.camera instanceof PerspectiveCamera) {
            this.camera.aspect = width / height;
        } else if (this.camera instanceof OrthographicCamera) {
            this.updateOrthographicCamera(this.camera);
        }
        this.camera.updateProjectionMatrix();
    }

    private updateOrthographicCamera(camera: OrthographicCamera) {
        const aspect = this._width / this._height;
        let length = this._position.distanceTo(this._target);
        let frustumHalfHeight = length * Math.tan((CAMERA_FOV * DEG_TO_RAD) / 2);
        camera.left = -frustumHalfHeight * aspect;
        camera.right = frustumHalfHeight * aspect;
        camera.top = frustumHalfHeight;
        camera.bottom = -frustumHalfHeight;
    }

    startRotate(x: number, y: number): void {
        const box = new Box3();
        const nodes = this.view.document.selection.getSelectedNodes();
        if (nodes.length > 0) {
            for (const node of nodes) {
                const shape = this.view.document.visual.context.getVisual(node) as ThreeVisualObject;
                box.expandByObject(shape);
            }
            this._rotateCenter = box.getCenter(new Vector3());
            return;
        }

        const shape = this.view.detectVisual(x, y).at(0);
        if (shape instanceof ThreeVisualObject) {
            box.setFromObject(shape);
            this._rotateCenter = box.getCenter(new Vector3());
            return;
        }

        this._rotateCenter = undefined;
    }

    rotate(dx: number, dy: number): void {
        const center = this._rotateCenter ?? this._target;
        const direction = this._position.clone().sub(center);
        const hor = this.camera.up.clone().cross(direction).normalize();

        const matrixX = new Matrix4().makeRotationAxis(
            hor,
            -this.ensureRotateY(direction, dy) * ROTATE_SPEED,
        );
        const matrixY = new Matrix4().makeRotationAxis(this.camera.up, -dx * ROTATE_SPEED);
        const matrix = new Matrix4().multiplyMatrices(matrixY, matrixX);

        this._position = ThreeHelper.transformVector(matrix, direction).add(center);
        if (this._rotateCenter) {
            const targetToEye = this._target.clone().sub(this._camera.position);
            this._target = ThreeHelper.transformVector(matrix, targetToEye).add(this._position);
        }

        this.updateCameraPosionTarget();
    }

    private ensureRotateY(direction: Vector3, dy: number) {
        const currentPitch = Math.PI / 2 - direction.angleTo(Camera.DEFAULT_UP);
        const targetPitch = currentPitch + dy * ROTATE_SPEED;
        if (targetPitch > MAX_PITCH_ANGLE) {
            dy = (MAX_PITCH_ANGLE - currentPitch) / ROTATE_SPEED;
        } else if (targetPitch < -MAX_PITCH_ANGLE) {
            dy = (-MAX_PITCH_ANGLE - currentPitch) / ROTATE_SPEED;
        }
        return dy;
    }

    fitContent(): void {
        const context = this.view.document.visual.context as ThreeVisualContext;
        const sphere = this.getBoundingSphere(context);
        let fieldOfView = CAMERA_FOV / 2.0;
        if (this._width < this._height) {
            fieldOfView = (fieldOfView * this._width) / this._height;
        }

        const distance = sphere.radius / Math.sin(fieldOfView * DEG_TO_RAD);
        const direction = this._target.clone().sub(this._position).normalize();
        this._target.copy(sphere.center);
        this._position.copy(this._target.clone().sub(direction.clone().multiplyScalar(distance)));

        if (this._camera instanceof OrthographicCamera) {
            this.updateOrthographicCamera(this._camera);
        }

        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    private getBoundingSphere(context: ThreeVisualContext) {
        const sphere = new Sphere();
        const shapes = this.view.document.selection
            .getSelectedNodes()
            .filter((x) => x instanceof VisualNode);
        if (shapes.length === 0) {
            new Box3().setFromObject(context.visualShapes).getBoundingSphere(sphere);
            return sphere;
        }

        const box = new Box3();
        for (let shape of shapes) {
            let threeGeometry = context.getVisual(shape) as ThreeGeometry;
            let boundingBox = new Box3().setFromObject(threeGeometry);
            if (boundingBox) {
                box.union(boundingBox);
            }
        }
        box.getBoundingSphere(sphere);
        return sphere;
    }

    zoom(x: number, y: number, delta: number): void {
        const vector = this._target.clone().sub(this._position);

        let zoomFactor = this.caclueZoomFactor(x, y, vector);
        const scale = delta > 0 ? zoomFactor : -zoomFactor;
        let mouse = this.mouseToWorld(x, y);
        if (this._camera instanceof PerspectiveCamera) {
            mouse = this.caculePerspectiveCameraMouse(vector, mouse);
        }
        const targetMoveVector = this._target.clone().sub(mouse).multiplyScalar(scale);
        this._target.add(targetMoveVector);
        this._position.copy(this._target.clone().sub(vector.clone().multiplyScalar(1 + scale)));
        if (vector.length() < MIN_CARME_TO_TARGET) {
            this._target = this._position
                .clone()
                .add(vector.clone().normalize().multiplyScalar(MIN_CARME_TO_TARGET));
        }

        if (this._camera instanceof OrthographicCamera) {
            this.updateOrthographicCamera(this._camera);
        }
        this.updateCameraNearFar();
        this.updateCameraPosionTarget();
    }

    private caclueZoomFactor(x: number, y: number, direction: Vector3) {
        const raycaster = new Raycaster();
        raycaster.setFromCamera(this.view.screenToCameraRect(x, y), this.camera);
        const intersect = raycaster.intersectObjects(this.view.content.visualShapes.children).at(0)?.point;
        let zoomFactor = ZOOM_SPEED_FACTOR;
        if (intersect) {
            zoomFactor = (ZOOM_SPEED_FACTOR * this._position.distanceTo(intersect)) / direction.length();
        }
        return zoomFactor;
    }

    private updateCameraNearFar() {
        const distance = this._position.distanceTo(this._target);
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
        const directionNormal = direction.clone().normalize();
        const dot = mouse.clone().sub(this._position).dot(directionNormal);
        const project = this._position.clone().add(directionNormal.clone().multiplyScalar(dot));
        const length = (project.distanceTo(mouse) * direction.length()) / project.distanceTo(this._position);
        const v = mouse.clone().sub(project).normalize().multiplyScalar(length);
        mouse = this._target.clone().add(v);
        return mouse;
    }

    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike): void {
        this._position.set(eye.x, eye.y, eye.z);
        this._target.set(target.x, target.y, target.z);
        this.camera.up.set(up.x, up.y, up.z);
        this.updateCameraPosionTarget();
    }

    private mouseToWorld(mx: number, my: number) {
        const x = (2.0 * mx) / this._width - 1;
        const y = (-2.0 * my) / this._height + 1;
        const dist = this._position.distanceTo(this._target);
        const z = (this._camera.far + this._camera.near - 2 * dist) / (this._camera.near - this._camera.far);

        return new Vector3(x, y, z).unproject(this._camera);
    }
}
