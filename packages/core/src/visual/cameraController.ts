// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDisposable, IPropertyChanged } from "../foundation";
import type { XYZ, XYZLike } from "../math";

export type CameraType = "perspective" | "orthographic";

/** The duration a view-changing fly-to takes, in milliseconds. */
export const CAMERA_FLY_DURATION = 500;

export interface CameraTransitionOptions {
    /** Milliseconds to reach the pose; 0 or omitted puts the camera there at once. */
    duration?: number;
}

export interface ICameraController extends IPropertyChanged, IDisposable {
    readonly cameraPosition: XYZ;
    readonly cameraTarget: XYZ;
    readonly cameraUp: XYZ;

    cameraType: CameraType;
    fitContent(options?: CameraTransitionOptions): void;
    lookAt(eye: XYZLike, target: XYZLike, up: XYZLike, options?: CameraTransitionOptions): void;
    pan(dx: number, dy: number): void;
    startRotate(x: number, y: number): void;
    rotate(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
    updateCameraPosionTarget(): void;
}
