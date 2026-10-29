// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Chili3D scene units are millimetres; all crane planning calculations stay in metres. */
export const MILLIMETRES_PER_METRE = 1000;

/**
 * Convert a metre measurement to millimetres exactly once, at the Chili3D
 * boundary. Callers must not pre-convert and then call this again.
 */
export function metresToMillimetres(metres: number): number {
    return metres * MILLIMETRES_PER_METRE;
}