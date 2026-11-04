// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IShape, type ISolid, type IWire, Result, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "@chili3d/wasm";
import { metresToMm, type Point2D } from "./types";

/**
 * Extrudes a 2D polygon footprint (in metres) by a given height (in metres)
 * into a 3D solid using the Chili3D ShapeFactory.
 *
 * All inputs are in metres; converted to millimetres (x1000) for the CAD kernel.
 */
export function extrudeBuildingSolid(
    factory: ShapeFactory,
    polygonInMetres: Point2D[],
    heightInMetres: number,
): Result<ISolid, string> {
    if (polygonInMetres.length < 3) {
        return Result.err("Extrusion requires at least 3 points in footprint polygon.");
    }

    if (heightInMetres <= 0) {
        return Result.err(`Invalid height: ${heightInMetres} m. Height must be positive.`);
    }

    // 1. Convert 2D vertices to millimetres in the XY plane
    const ptsMm = polygonInMetres.map((p) => ({
        x: metresToMm(p.x),
        y: metresToMm(p.y),
        z: 0,
    }));

    // 2. Build edges for the closed perimeter
    const edges: IEdge[] = [];
    const count = ptsMm.length;

    for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        // Avoid zero-length edges
        const dx = ptsMm[next].x - ptsMm[i].x;
        const dy = ptsMm[next].y - ptsMm[i].y;
        if (Math.hypot(dx, dy) < 0.001) {
            continue;
        }

        const lineResult = factory.line(new XYZ(ptsMm[i]), new XYZ(ptsMm[next]));
        if (!lineResult.isOk) {
            return Result.err(`Failed to create boundary line: ${lineResult.error}`);
        }
        edges.push(lineResult.value);
    }

    if (edges.length < 3) {
        return Result.err("Failed to construct closed boundary: less than 3 valid edges.");
    }

    // 3. Create closed Wire
    const wireResult = factory.wire(edges);
    if (!wireResult.isOk) {
        return Result.err(`Failed to create wire from boundary edges: ${wireResult.error}`);
    }

    // 4. Create planar Face
    const faceResult = factory.face([wireResult.value as IWire]);
    if (!faceResult.isOk) {
        return Result.err(`Failed to create face from wire: ${faceResult.error}`);
    }

    // 5. Extrude into Solid along +Z
    const heightMm = metresToMm(heightInMetres);
    const prismVector = new XYZ({ x: 0, y: 0, z: heightMm });
    const solidResult = factory.prism(faceResult.value, prismVector);

    if (!solidResult.isOk) {
        return Result.err(`Extrusion prism failed: ${solidResult.error}`);
    }

    return Result.ok(solidResult.value as ISolid);
}

/**
 * Computes solid volume in cubic metres (m³).
 * The CAD kernel returns volume in mm³.
 * 1 m³ = 1,000,000,000 mm³ (1e9).
 */
export function getSolidVolumeM3(solid: IShape): number {
    const rawVolumeMm3 = (solid as unknown as { volume: () => number }).volume();
    return rawVolumeMm3 / 1e9;
}
