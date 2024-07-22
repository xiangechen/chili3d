// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDisposable } from "../foundation";

export enum GeometryType {
    Curve,
    Surface,
}

export interface IGeometry extends IDisposable {
    get geometryType(): GeometryType;
    copy(): IGeometry;
}
