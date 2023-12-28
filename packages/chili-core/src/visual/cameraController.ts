// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export interface Point {
    x: number;
    y: number;
    z: number;
}

export interface ICameraController {
    cameraType: "perspective" | "orthographic";
    fitContent(): void;
    lookAt(eye: Point, target: Point, up: Point): void;
    pan(dx: number, dy: number): void;
    startRotate(x: number, y: number): void;
    rotate(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
}
