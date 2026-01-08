// Part of the Chili3d Project, under the AGPL-3.0 Licensettt.
// See LICENSE file in the project root for full license information.

export interface IHighlightable {
    highlight(): void;
    unhighlight(): void;
}

export function isHighlightable(value: any): value is IHighlightable {
    return value && typeof value.highlight === "function" && typeof value.unhighlight === "function";
}
