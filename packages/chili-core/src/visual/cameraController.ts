// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { XYZ } from "../math";

export interface ICameraController {
    fitContent(): void;
    lookAt(eye: XYZ, target: XYZ): void;
    pan(dx: number, dy: number): void;
    startRotation(dx: number, dy: number): void;
    rotate(dx: number, dy: number): void;
    zoom(x: number, y: number, delta: number): void;
}
