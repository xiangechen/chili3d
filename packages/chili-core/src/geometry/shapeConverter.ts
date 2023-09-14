// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "../base";
import { IShape } from "./shape";

export interface IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string>;
    convertFromIGES(iges: string): Result<IShape>;
    convertToSTEP(...shapes: IShape[]): Result<string>;
    convertFromSTEP(step: string): Result<IShape>;
}
