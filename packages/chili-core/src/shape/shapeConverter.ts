// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../foundation";
import { IShape } from "./shape";

export interface IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string>;
    convertFromIGES(iges: Uint8Array): Result<IShape[]>;
    convertToSTEP(...shapes: IShape[]): Result<string>;
    convertFromSTEP(step: Uint8Array): Result<IShape[]>;
    convertToBrep(shape: IShape): Result<string>;
    convertFromBrep(brep: string): Result<IShape>;
}
