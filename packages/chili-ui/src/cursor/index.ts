// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CursorType } from "chili-core";
import draw from "./draw.cur";

const cursors: Map<CursorType, string> = new Map([
    ["default", "default"],
    ["draw", `url(${draw}), default`],
    ["select.default", "crosshair"],
]);

export class Cursor {
    static get(type: CursorType) {
        return cursors.get(type) ?? "default";
    }
}
