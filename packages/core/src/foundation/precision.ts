// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const Precision = {
    Distance: 1e-7,
    Angle: 1e-3,
    Float: 1e-7,
    /** Parametric-space tolerance, mirroring OCCT's Precision::PConfusion(). */
    PConfusion: 1e-9,
    /**
     * How far off a face a picked point may sit and still count as lying on it, in model
     * units. Picking is pixel-based, so this is far looser than kernel tolerances.
     */
    OnSurface: 1e-3,
};
