// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export enum GeometryType {
    Curve,
    Surface,
}

export interface IGeometry {
    get geometryType(): GeometryType;
    copy(): IGeometry;
}
