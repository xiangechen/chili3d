// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CursorType } from "chili-core";
import draw from "./draw.cur";

const cursors: Map<CursorType, string> = new Map([
    ["default", "default"],
    ["draw", `url(${draw}), default`],
    ["select.default", "crosshair"],
]);

export namespace Cursor {
    export function get(type: CursorType) {
        return cursors.get(type) ?? "default";
    }
}
