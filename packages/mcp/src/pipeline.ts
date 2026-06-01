// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Deep import (not the @chili3d/app barrel) to stay headless-safe — see headless.ts.
import { BoxNode } from "@chili3d/app/src/bodys/box";
import {
    type IDocument,
    type IShape,
    type ISolid,
    Plane,
    type Serialized,
    ShapeNode,
    ShapeTypes,
    type StlExportOptions,
    Transaction,
    XYZ,
} from "@chili3d/core";
import type { HeadlessApplication } from "./headless";

export interface BoxParams {
    dx: number;
    dy: number;
    dz: number;
    /** Min corner of the box; defaults to the origin. */
    location?: { x: number; y: number; z: number };
}

/** Add a parametric box to a document (history-tracked, like the UI command). */
export function addBox(document: IDocument, params: BoxParams): BoxNode {
    const loc = params.location;
    const plane = loc ? Plane.XY.translateTo(new XYZ({ x: loc.x, y: loc.y, z: loc.z })) : Plane.XY;
    let node!: BoxNode;
    Transaction.execute(document, "add box", () => {
        node = new BoxNode({ document, plane, dx: params.dx, dy: params.dy, dz: params.dz });
        document.modelManager.addNode(node);
    });
    return node;
}

/**
 * Every generated shape in the document, in WORLD space. We apply the node's
 * worldTransform() (like the app's getExportShapes) so any node-level transform is
 * reflected in export — without it a moved/rotated node would export at the origin.
 */
export function collectShapes(document: IDocument): IShape[] {
    const shapes: IShape[] = [];
    for (const node of document.modelManager.findNodes((n) => n instanceof ShapeNode)) {
        const shapeNode = node as ShapeNode;
        const result = shapeNode.shape;
        if (result.isOk) {
            shapes.push(result.value.transformedMul(shapeNode.worldTransform()));
        }
    }
    return shapes;
}

/** Headless STL bytes for the whole document. Binary by default. */
export function documentToStl(
    application: HeadlessApplication,
    document: IDocument,
    options?: StlExportOptions,
): Uint8Array {
    const shapes = collectShapes(document);
    const result = application.shapeFactory.converter.convertToSTL(shapes, options);
    if (!result.isOk) {
        throw new Error(`STL export failed: ${result.error}`);
    }
    return result.value;
}

/** The document as a `.cd` serialized object — what the browser app opens. */
export function serializeDocument(document: IDocument): Serialized {
    return document.serialize();
}

export interface DocumentProperties {
    shapeCount: number;
    /** Summed volume of all solids (mm³). */
    totalVolume: number;
    /** Combined axis-aligned bounding box of the whole model (undefined if empty). */
    boundingBox?: {
        min: { x: number; y: number; z: number };
        max: { x: number; y: number; z: number };
        size: { x: number; y: number; z: number };
    };
}

/** Measure the document: overall bounding box + total solid volume (for verification). */
export function measureDocument(document: IDocument): DocumentProperties {
    const shapes = collectShapes(document);
    let totalVolume = 0;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (const shape of shapes) {
        const bb = shape.boundingBox();
        min.x = Math.min(min.x, bb.min.x);
        min.y = Math.min(min.y, bb.min.y);
        min.z = Math.min(min.z, bb.min.z);
        max.x = Math.max(max.x, bb.max.x);
        max.y = Math.max(max.y, bb.max.y);
        max.z = Math.max(max.z, bb.max.z);
        // A boolean result is often a compound wrapping the solid, so descend into
        // sub-solids rather than only counting shapes that are themselves a solid.
        const solids = shape.shapeType === ShapeTypes.solid ? [shape] : shape.findSubShapes(ShapeTypes.solid);
        for (const solid of solids) {
            totalVolume += (solid as ISolid).volume();
        }
    }

    const boundingBox = Number.isFinite(min.x)
        ? { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } }
        : undefined;
    return { shapeCount: shapes.length, totalVolume, boundingBox };
}
