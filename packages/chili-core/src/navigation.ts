// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "./config";

export namespace Navigation3D {
    export enum Nav3DType {
        Chili3d = 0,
        Revit,
        Blender,
        Creo,
        Solidworks,
    }
    export const types: string[] = [Nav3DType[0], Nav3DType[1], Nav3DType[2], Nav3DType[3], Nav3DType[4]];

    export function getKey(event: MouseEvent) {
        let key = "Middle";
        if (event.shiftKey) {
            key = "Shift+" + key;
        }
        if (event.ctrlKey) {
            key = "Ctrl+" + key;
        }
        if (event.altKey) {
            key = "Alt+" + key;
        }
        return key;
    }

    export function navigationKeyMap(): {
        pan: string;
        rotate: string;
    } {
        const functionKey = {
            [Nav3DType.Chili3d]: {
                pan: "Middle",
                rotate: "Shift+Middle",
            },
            [Nav3DType.Revit]: {
                pan: "Middle",
                rotate: "Shift+Middle",
            },
            [Nav3DType.Blender]: {
                pan: "Shift+Middle",
                rotate: "Middle",
            },
            [Nav3DType.Creo]: {
                pan: "Shift+Middle",
                rotate: "Middle",
            },
            [Nav3DType.Solidworks]: {
                pan: "Ctrl+Middle",
                rotate: "Middle",
            },
        };
        return functionKey[Config.instance.navigation3DIndex as Nav3DType];
    }
}
