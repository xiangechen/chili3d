// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CameraTransitionOptions,
    type CameraType,
    type ICameraController,
    MathUtils,
    Observable,
    type ViewMode,
    type XYZLike,
} from "@chili3d/core";
import {
    Box3,
    Camera,
    Object3D,
    OrthographicCamera,
    PerspectiveCamera,
    Quaternion,
    Raycaster,
    Sphere,
    Vector3,
} from "three";
import { Constants } from "./constants";
import type { ThreeGeometry } from "./threeGeometry";
import { ThreeHelper } from "./threeHelper";
import type { ThreeView } from "./threeView";
import type { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";

const DEG_TO_RAD = Math.PI / 180.0;
const ZOOM_SPEED_FACTOR = 0.1;
const ROTATE_SPEED_FACTOR = 0.5;
const PAN_SPEED_FACTOR = 0.002;
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 1e6;
const MIN_CARME_TO_TARGET = 50;
const SHAPE_EMPTY_SIZE = 800;
// A frame that arrives late (a background tab waking up) must not skip the whole fly-to.
const MAX_TRANSITION_STEP_MS = 100;

const NO_ROTATION = new Quaternion();

Camera.DEFAULT_UP = new Vector3(0, 0, 1);

/** A camera pose: where it sits, what it looks at, and which way is up. */
interface CameraPose {
    position: Vector3;
    target: Vector3;
    up: Vector3;
}

interface CameraTransition {
    readonly from: CameraPose;
    readonly to: CameraPose;
    /** Carries `from.up` onto `to.up`; a quaternion so that opposite ups don't collapse to zero. */
    readonly upRotation: Quaternion;
    elapsed: number;
    readonly duration: number;
}

function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class CameraController extends Observable implements ICameraController {
    private _width: number = 100;
    private _height: number = 100;
    private _target: Vector3 = new Vector3();
    private _position: Vector3 = new Vector3(1500, 1500, 1500);
    private _rotateCenter: Vector3 | undefined;
    private _camera: PerspectiveCamera | OrthographicCamera;
    private _transition?: CameraTransition;

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
        if (mode === "wireframe") {
            camera.layers.enable(Constants.Layers.Wireframe);
            camera.layers.disable(Constants.Layers.Solid);
        } else if (mode === "solid") {
            camera.layers.enable(Constants.Layers.Solid);
            camera.layers.disable(Constants.Layers.Wireframe);
        } else {
            camera.layers.enableAll();
        }
    }

    pan(dx: number, dy: number): void {
        this.cancelTransition();
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
        const oldValue = this.cameraPosition;
        this._camera.position.copy(this._position);
        this._camera.lookAt(this._target);
        this._camera.updateProjectionMatrix();
        this.emitPropertyChanged("cameraPosition", oldValue);
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
        const length = this._position.distanceTo(this._target);
        const frustumHalfHeight = length * Math.tan((CAMERA_FOV * DEG_TO_RAD) / 2);
        camera.left = -frustumHalfHeight * aspect;
        camera.right = frustumHalfHeight * aspect;
        camera.top = frustumHalfHeight;
        camera.bottom = -frustumHalfHeight;
    }

    startRotate(x: number, y: number): void {
        this.cancelTransition();
        this._rotateCenter = this.selectedNodesCenter();
        if (this._rotateCenter) {
            return;
        }

        const shape = this.view.detectVisual(x, y).at(0);
        if (shape instanceof ThreeVisualObject) {
            const box = new Box3();
            box.setFromObject(shape);
            this._rotateCenter = box.getCenter(new Vector3());
        }
    }

    private selectedNodesCenter() {
        const box = new Box3();
        const nodes = this.view.document.selection.getSelectedNodes();
        if (nodes.length > 0) {
            for (const node of nodes) {
                const shape = this.view.document.visual.context.getVisual(node);
                if (shape instanceof Object3D) {
                    box.expandByObject(shape);
                }
            }
            return box.getCenter(new Vector3());
        }
        return undefined;
    }

    setRotateCenterToSelected() {
        this._rotateCenter = this.selectedNodesCenter();
    }

    rotate(dx: number, dy: number): void {
        this.cancelTransition();
        const newRotation = this.getRotation(dx * ROTATE_SPEED_FACTOR, dy * ROTATE_SPEED_FACTOR);

        this._camera.up.copy(new Vector3(0, 1, 0).applyQuaternion(newRotation));

        const distance = this._position.distanceTo(this._target);
        const eyeToCenter = new Vector3(0, 0, distance).applyQuaternion(newRotation);
        let currentPosition = this._target.clone().add(eyeToCenter);

        if (this._rotateCenter) {
            const diffPosition = currentPosition.clone().sub(this._position);
            const diffRotation = newRotation.clone().multiply(this._camera.quaternion.clone().invert());
            const targetAfterTrans = this._rotateCenter
                .clone()
                .sub(this._position)
                .applyQuaternion(diffRotation)
                .add(diffPosition)
                .add(this._position)
                .sub(this._rotateCenter);

            const currentCenter = this._target.clone().sub(targetAfterTrans);
            currentPosition = currentCenter.clone().add(eyeToCenter);

            this._target.copy(currentCenter);
        }

        this._position.copy(currentPosition);
        this.updateCameraPosionTarget();
    }

    private getRotation(dx: number, dy: number) {
        const rotationDy = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(-dy));
        const tmpRotation = this._camera.quaternion.clone().multiply(rotationDy);
        const tmpRotationInv = tmpRotation.clone().invert();
        const rotationDx = new Quaternion().setFromAxisAngle(
            new Vector3(0, 0, 1).applyQuaternion(tmpRotationInv),
            MathUtils.degToRad(-dx),
        );
        return tmpRotation.clone().multiply(rotationDx);
    }

    fitContent(options?: CameraTransitionOptions): void {
        const context = this.view.document.visual.context as ThreeVisualContext;
        const sphere = this.getBoundingSphere(context);
        let fieldOfView = CAMERA_FOV / 2.0;
        if (this._width < this._height) {
            fieldOfView = (fieldOfView * this._width) / this._height;
        }

        const distance = Math.abs(sphere.radius / Math.sin(fieldOfView * DEG_TO_RAD));
        // Framed along the direction the camera is heading, not a mid-flight one, so the lookAt that
        // opens a sketch still decides the orientation when a fitContent follows it immediately.
        const base = this.settledPose();
        const direction = base.target.clone().sub(base.position).normalize();

        this.beginTransition(
            {
                position: sphere.center.clone().sub(direction.multiplyScalar(distance)),
                target: sphere.center.clone(),
                up: base.up,
            },
            options?.duration,
        );
    }

    private getBoundingSphere(context: ThreeVisualContext) {
        const shapes = this.view.document.selection.getSelectedVisualNodes();

        const box = new Box3();
        if (shapes.length === 0) {
            box.setFromObject(context.visualShapes);
        } else {
            for (const shape of shapes) {
                const threeGeometry = context.getVisual(shape) as ThreeGeometry;
                const boundingBox = new Box3().setFromObject(threeGeometry);
                if (boundingBox) {
                    box.union(boundingBox);
                }
            }
        }

        const sphere = new Sphere();
        box.getBoundingSphere(sphere);
        if (sphere.radius < 0) {
            sphere.radius = SHAPE_EMPTY_SIZE;
        }
        return sphere;
    }

    zoom(x: number, y: number, delta: number): void {
        this.cancelTransition();
        const vector = this._target.clone().sub(this._position);

        const zoomFactor = this.caclueZoomFactor(x, y, vector);
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

        this.updateLens();
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

        const nearPlane = Math.max(0.01, Math.min(distance / 1000, distance / 10));
        const farPlane = Math.max(1000, distance * 100);

        this.camera.near = nearPlane;
        this.camera.far = farPlane;
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

    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike, options?: CameraTransitionOptions): void {
        this.beginTransition(
            {
                position: new Vector3(eye.x, eye.y, eye.z),
                target: new Vector3(target.x, target.y, target.z),
                up: new Vector3(up.x, up.y, up.z),
            },
            options?.duration,
        );
    }

    /**
     * Advances a fly-to by one frame. Returns true while the camera is still moving, so the caller
     * keeps redrawing.
     */
    tick(deltaMs: number): boolean {
        const transition = this._transition;
        if (!transition) {
            return false;
        }

        transition.elapsed += Math.min(Math.max(deltaMs, 0), MAX_TRANSITION_STEP_MS);
        const t = Math.min(1, transition.elapsed / transition.duration);
        const k = easeInOutCubic(t);

        this._position.lerpVectors(transition.from.position, transition.to.position, k);
        this._target.lerpVectors(transition.from.target, transition.to.target, k);
        this._camera.up
            .copy(transition.from.up)
            .applyQuaternion(new Quaternion().slerpQuaternions(NO_ROTATION, transition.upRotation, k));
        if (t >= 1) {
            this._transition = undefined;
        }

        this.updateLens();
        this.updateCameraPosionTarget();
        return true;
    }

    /**
     * Reaches `to` over `duration` ms, or on the spot when there is none. A transition already under
     * way is retargeted rather than restarted, and its new start is the pose on screen right now —
     * so a caller that chains two pose changes (a lookAt then a fitContent) gets one continuous move.
     */
    private beginTransition(to: CameraPose, duration?: number): void {
        if (duration === undefined || duration <= 0) {
            this._transition = undefined;
            this.commitPose(to);
            return;
        }

        const from = this.currentPose();
        this._transition = {
            from,
            to,
            upRotation: new Quaternion().setFromUnitVectors(
                from.up.clone().normalize(),
                to.up.clone().normalize(),
            ),
            elapsed: 0,
            duration,
        };
    }

    private commitPose(pose: CameraPose): void {
        this._position.copy(pose.position);
        this._target.copy(pose.target);
        this._camera.up.copy(pose.up);
        this.updateLens();
        this.updateCameraPosionTarget();
    }

    private cancelTransition(): void {
        this._transition = undefined;
    }

    private currentPose(): CameraPose {
        return {
            position: this._position.clone(),
            target: this._target.clone(),
            up: this._camera.up.clone(),
        };
    }

    /**
     * The pose the camera is heading to: the transition target while one runs, the pose it sits at
     * otherwise. Pose changes build on this so they compose with a fly-to still in flight.
     */
    private settledPose(): CameraPose {
        return this._transition?.to ?? this.currentPose();
    }

    /** Keeps the projection in step with the camera distance — frustum and clip planes both track it. */
    private updateLens(): void {
        if (this._camera instanceof OrthographicCamera) {
            this.updateOrthographicCamera(this._camera);
        }
        this.updateCameraNearFar();
    }

    private mouseToWorld(mx: number, my: number) {
        const x = (2.0 * mx) / this._width - 1;
        const y = (-2.0 * my) / this._height + 1;
        const dist = this._position.distanceTo(this._target);
        const z = (this._camera.far + this._camera.near - 2 * dist) / (this._camera.near - this._camera.far);

        return new Vector3(x, y, z).unproject(this._camera);
    }
}
