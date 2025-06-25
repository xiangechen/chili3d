// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "../foundation";
import { VisualNode } from "../model";

export interface IMeshExporter {
    exportToStl(node: VisualNode[], asciiMode: boolean): Result<BlobPart>;
    exportToPly(node: VisualNode[], asciiMode: boolean): Result<BlobPart>;
    exportToObj(node: VisualNode[]): Result<BlobPart>;
}
