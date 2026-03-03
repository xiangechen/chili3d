// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export class Constants {
    static readonly RaycasterThreshold = 10;
    static readonly Layers = Object.freeze({
        Default: 0,
        Wireframe: 1,
        Solid: 2,
        Isolation: 30,
    });
}
