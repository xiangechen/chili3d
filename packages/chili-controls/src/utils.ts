// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Localize, PathBinding } from "chili-core";
import type { HTMLProps } from "./htmlProps";

export function setProperties<T extends { [K: string]: any }>(left: T, prop: HTMLProps<T>) {
    for (const key in prop) {
        const value = prop[key];
        if (value instanceof Localize && (key === "textContent" || key === "title")) {
            value.set(left, key);
        } else if (value instanceof PathBinding) {
            value.setBinding(left, key);
        } else if (typeof value === "object" && typeof left[key] === "object") {
            setProperties(left[key], value);
        } else {
            (left as any)[key] = value;
        }
    }
}
