// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export namespace Navigation3D {
    export enum Nav3DType {
        Chili3d = 0,
        Revit,
        Blender,
        Creo,
        Solidworks,
    }
    export const types: string[] = [Nav3DType[0], Nav3DType[1], Nav3DType[2], Nav3DType[3], Nav3DType[4]];

    let _currentIndex: number = 0;

    export function currentIndex() {
        return _currentIndex;
    }

    export function changeType(index: number) {
        if (index < 0 || index >= types.length) {
            return;
        }
        _currentIndex = index;
    }
}
