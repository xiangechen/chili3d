// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
