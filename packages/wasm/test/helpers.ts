// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ISolid, Plane, XYZ } from "@chili3d/core";
import { OccShapeConverter } from "../src/converter";
import { ShapeFactory } from "../src/factory";

/**
 * Create a fresh ShapeFactory instance for testing.
 */
export function createTestFactory(): ShapeFactory {
    return new ShapeFactory();
}

/**
 * Create a fresh OccShapeConverter instance for testing.
 */
export function createTestConverter(): OccShapeConverter {
    return new OccShapeConverter();
}

/**
 * Create a box solid at Plane.XY with the given dimensions.
 * Throws if creation fails — use only in test setup where failure is unexpected.
 */
export function createBox(factory: ShapeFactory, dx = 10, dy = 20, dz = 30): ISolid {
    const result = factory.box(Plane.XY, dx, dy, dz);
    if (!result.isOk) throw new Error(`box creation failed: ${result.error}`);
    return result.value as ISolid;
}

/**
 * Create a sphere solid at the origin with the given radius.
 * Throws if creation fails.
 */
export function createSphere(factory: ShapeFactory, center = XYZ.zero, radius = 10): ISolid {
    const result = factory.sphere(center, radius);
    if (!result.isOk) throw new Error(`sphere creation failed: ${result.error}`);
    return result.value as ISolid;
}

/**
 * Unwrap a Result, throwing with a clear message if it's an error.
 * Use this instead of bare `.value` to get meaningful test failures.
 */
export function unwrapOk<T>(result: { isOk: boolean; value: T; error?: string }): T {
    if (!result.isOk) throw new Error(`unexpected error: ${result.error ?? "unknown"}`);
    return result.value;
}
