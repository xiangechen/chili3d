// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { IShape } from "./shape";

export type ShapeInfo = {
    name: string;
    shape: IShape;
    color: string;
};

export interface IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string>;
    convertFromIGES(iges: Uint8Array): Result<ShapeInfo[]>;
    convertToSTEP(...shapes: IShape[]): Result<string>;
    convertFromSTEP(step: Uint8Array): Result<ShapeInfo[]>;
    convertToBrep(shape: IShape): Result<string>;
    convertFromBrep(brep: string): Result<IShape>;
}
