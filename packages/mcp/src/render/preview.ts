// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "@chili3d/core";
import { collectShapes } from "../pipeline";
import { encodePng } from "./png";
import {
    composeGrid,
    type RasterMesh,
    type RenderOptions,
    renderMeshesToRgba,
    type ViewName,
} from "./raster";

/** OCCT face meshes of every shape in the document (lazily tessellated). */
export function documentMeshes(document: IDocument): RasterMesh[] {
    const meshes: RasterMesh[] = [];
    for (const shape of collectShapes(document)) {
        const faces = shape.mesh.faces;
        if (faces && faces.index.length > 0) {
            meshes.push({ position: faces.position, index: faces.index });
        }
    }
    return meshes;
}

/** Render an isometric PNG preview of the document. Returns the PNG bytes. */
export function renderPreview(document: IDocument, options?: RenderOptions): Buffer {
    const { width, height, rgba } = renderMeshesToRgba(documentMeshes(document), options);
    return encodePng(width, height, rgba);
}

// 2x2 sheet, left-to-right then top-to-bottom: front, right, top, iso.
const SHEET_VIEWS: ViewName[] = ["front", "right", "top", "iso"];

/**
 * Render a 2x2 orthographic "three-view" sheet (front / right / top / iso) as one
 * PNG, for a human to sanity-check the geometry before it is pushed to the live view.
 * `size` is the per-panel pixel size (default 320).
 */
export function renderViews(document: IDocument, options?: { size?: number }): Buffer {
    const size = options?.size ?? 320;
    const meshes = documentMeshes(document);
    const panels = SHEET_VIEWS.map((view) => renderMeshesToRgba(meshes, { width: size, height: size, view }));
    const { width, height, rgba } = composeGrid(panels, 2);
    return encodePng(width, height, rgba);
}
