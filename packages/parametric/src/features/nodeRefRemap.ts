// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FeatureData } from "./feature";
import { featureHandler } from "./feature";

/**
 * Rewrites a feature's node references through `mapping`.
 *
 * The allowlist is the handler's own `nodeIds()` — the same list the body uses to watch
 * and cache — so a feature kind that correctly reports its references needs no
 * per-type branch here. Values are replaced only when the WHOLE string is a mapped id;
 * scoped ids such as `sketch:<id>:…` or `tool:<id>:…` are left alone (they are rebuilt
 * from the new scope, not renamed by the copy).
 */
export function remapFeatureRefs(feature: FeatureData, mapping: ReadonlyMap<string, string>): FeatureData {
    if (mapping.size === 0) return feature;
    const references = new Set(featureHandler(feature.type)?.nodeIds(feature) ?? []);
    if (references.size === 0) return feature;
    return remapValue(feature, references, mapping) as FeatureData;
}

function remapValue(
    value: unknown,
    references: ReadonlySet<string>,
    mapping: ReadonlyMap<string, string>,
): unknown {
    if (typeof value === "string") {
        if (!references.has(value)) return value;
        return mapping.get(value) ?? value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => remapValue(item, references, mapping));
    }
    if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = remapValue(item, references, mapping);
        }
        return result;
    }
    return value;
}
