// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import type { Result } from "../foundation";
import type { FolderNode } from "../model";
import type { IShape } from "./shape";

export interface IShapeConverter {
    convertToIGES(...shapes: IShape[]): Result<string>;
    convertFromIGES(document: IDocument, iges: Uint8Array): Result<FolderNode>;
    convertToSTEP(...shapes: IShape[]): Result<string>;
    convertFromSTEP(document: IDocument, step: Uint8Array): Result<FolderNode>;
    convertToBrep(shape: IShape): Result<string>;
    convertFromBrep(brep: string): Result<IShape>;
    convertFromSTL(document: IDocument, stl: Uint8Array): Result<FolderNode>;
}
