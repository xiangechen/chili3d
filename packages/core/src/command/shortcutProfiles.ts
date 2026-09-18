// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Navigation3DType } from "../navigation";
import type { CommandKeys } from "./commandKeys";

type ShortcutMap = Partial<Record<CommandKeys, string | string[]>>;

const MODIFIER_KEYS = new Set(["ctrl", "shift", "alt"]);

/** Keys whose name is spelled out on screen rather than uppercased. */
const NAMED_KEYS = new Map([
    ["delete", "Delete"],
    ["backspace", "Backspace"],
    ["enter", "Enter"],
    ["escape", "Escape"],
    ["tab", "Tab"],
    ["space", "Space"],
]);

function displayKey(key: string): string {
    if (key === " ") return "Space";
    const named = NAMED_KEYS.get(key.toLowerCase());
    if (named !== undefined) return named;
    return key.length > 1 ? key : key.toUpperCase();
}

/**
 * Display form of one shortcut spec. A spec is leading modifiers plus a sequence of keys —
 * "ctrl+s" is Ctrl with S, while "m+v" is M then V (Revit's move), and modifiers apply to the
 * last key of a sequence.
 */
export function formatShortcutKey(key: string): string {
    const segments = key.split("+");
    const modifiers: string[] = [];
    while (segments.length > 1 && MODIFIER_KEYS.has(segments[0].toLowerCase())) {
        const modifier = segments.shift() ?? "";
        modifiers.push(modifier[0].toUpperCase() + modifier.slice(1));
    }

    const keys = segments.map(displayKey);
    const last = keys.pop() ?? "";
    keys.push([...modifiers, last].join("+"));
    return keys.join(" then ");
}

export const Chili3dShortcuts: ShortcutMap = {
    // System
    "doc.save": "ctrl+s",
    "doc.open": "ctrl+o",
    "edit.undo": "ctrl+z",
    "edit.redo": ["ctrl+y", "ctrl+shift+z"],
    "modify.deleteNode": ["Delete", "Backspace"],
    "special.last": [" ", "Enter"],

    // Sketching
    "create.line": "l",
    "create.rect": "r",
    "create.circle": "c",
    "measure.length": "d",

    // Primitives
    "create.box": "b",
    "create.sphere": "s",
    "create.cylinder": "y",
    "create.cone": "n",
    "create.pipe": "shift+p",

    // Modify
    "modify.trim": "t",
    "create.offset": "o",
    "modify.rotate": "shift+r",
    "create.extrude": "p",
    "modify.move": "m",
    "modify.array": "shift+a",
    "boolean.common": "shift+i",
    "modify.explode": "x",
    "modify.chamfer": "shift+c",
    "modify.fillet": "shift+f",
};

export const DefaultShortcuts: ShortcutMap = Chili3dShortcuts;

export const RevitShortcuts: ShortcutMap = {
    ...Chili3dShortcuts,
    "modify.move": "m+v", // MV
    "modify.rotate": "r+o", // RO
    "modify.trim": "t+r", // TR
    "create.line": "l+i", // LI
    // Add more as needed
};

export const BlenderShortcuts: ShortcutMap = {
    ...DefaultShortcuts,
    "modify.move": "g",
    "modify.rotate": "r",
    "create.extrude": "e",
    // "delete": "x" // if key exists
};

export const SolidworksShortcuts: ShortcutMap = {
    ...DefaultShortcuts,
    "create.line": "l",
    // Often heavily mouse/gesture based or S-key menu
};

export const CreoShortcuts: ShortcutMap = {
    ...DefaultShortcuts,
};

export const ShortcutProfiles: Record<Navigation3DType, ShortcutMap> = {
    Chili3d: Chili3dShortcuts,
    Revit: RevitShortcuts,
    Blender: BlenderShortcuts,
    Creo: CreoShortcuts,
    Solidworks: SolidworksShortcuts,
};
