// Per-user tool enablement, persisted in localStorage.
//
// The set of tool names is derived from `schemas` at runtime, so adding a new
// tool there automatically surfaces a checkbox in the settings dialog — the
// default is enabled unless the user has explicitly disabled it.
//
// Storage shape: { disabled: ToolName[] } (we only persist *disabled* names so
// new tools default to on without needing a migration).

import { schemas, type ToolName } from "../tools";

const KEY = "chili3d-ai-chat.disabledTools";

export function allToolNames(): ToolName[] {
    return Object.keys(schemas) as ToolName[];
}

export function loadDisabled(): Set<ToolName> {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw) as string[];
        if (!Array.isArray(arr)) return new Set();
        const known = new Set(allToolNames() as string[]);
        return new Set(arr.filter((n) => known.has(n)) as ToolName[]);
    } catch {
        return new Set();
    }
}

export function saveDisabled(disabled: Set<ToolName>) {
    localStorage.setItem(KEY, JSON.stringify([...disabled]));
}
