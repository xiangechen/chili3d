// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument } from "../document";
import { Result } from "../foundation";
import { FolderNode } from "../model";
import { IShape } from "./shape";

export interface IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string>;
    convertFromIGES(document: IDocument, iges: Uint8Array): Result<FolderNode>;
    convertToSTEP(...shapes: IShape[]): Result<string>;
    convertFromSTEP(document: IDocument, step: Uint8Array): Result<FolderNode>;
    convertToBrep(shape: IShape): Result<string>;
    convertFromBrep(brep: string): Result<IShape>;
}
