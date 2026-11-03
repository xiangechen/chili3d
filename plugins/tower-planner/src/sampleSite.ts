// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import sampleSiteData from "../../../public/sample-site/sample-site.json";
import type { Pick, PickPoint } from "./pickEngine";

/**
 * Canonical sample-site snapshot shared with the DXF and PNG fixtures. The
 * loader reads it directly instead of keeping a second copy of the five picks.
 */
export const SAMPLE_SITE_PATH = "public/sample-site/sample-site.json";

export type SampleSiteIssue = {
    /** JSON path such as `picks[2].from_xy[1]`. */
    path: string;
    message: string;
};

export type SampleSiteParseResult = { ok: true; picks: Pick[] } | { ok: false; issues: SampleSiteIssue[] };

/** The subset of the sample-site document this loader reads. */
type SampleSiteDocument = {
    picks?: unknown;
};

/** One entry of the sample-site `picks` array, before validation. */
type RawSampleSitePick = {
    id?: unknown;
    load_t?: unknown;
    from_xy?: unknown;
    to_xy?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPoint(value: unknown, path: string, issues: SampleSiteIssue[]): PickPoint | undefined {
    if (!Array.isArray(value) || value.length !== 2) {
        issues.push({ path, message: "must be an [x, y] pair" });
        return undefined;
    }

    const [x, y] = value;
    if (typeof x !== "number" || !Number.isFinite(x)) {
        issues.push({ path: `${path}[0]`, message: "must be a finite number" });
    }
    if (typeof y !== "number" || !Number.isFinite(y)) {
        issues.push({ path: `${path}[1]`, message: "must be a finite number" });
    }

    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return undefined;
    }

    return { x, y };
}

function readLoad(value: unknown, path: string, issues: SampleSiteIssue[]): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        issues.push({ path, message: "must be a finite number greater than zero" });
        return undefined;
    }
    return value;
}

function readLabel(value: unknown, path: string, issues: SampleSiteIssue[]): string | undefined {
    if (typeof value !== "string" || value.trim() === "") {
        issues.push({ path, message: "must be a non-empty string" });
        return undefined;
    }
    return value;
}

/**
 * Map `picks[]` from the sample-site document to engine picks:
 * `from_xy` -> `supply`, `to_xy` -> `drop`, `load_t` -> `loadT`.
 *
 * Every coordinate must be a finite `[x, y]` pair and every load a finite
 * positive number. Invalid entries are reported by JSON path; no default or
 * zero value is substituted.
 */
export function parseSampleSitePicks(data: unknown): SampleSiteParseResult {
    if (!isRecord(data)) {
        return { ok: false, issues: [{ path: "$", message: "must be a JSON object" }] };
    }

    const document = data as SampleSiteDocument;
    const rawPicks = document.picks;
    if (!Array.isArray(rawPicks) || rawPicks.length === 0) {
        return { ok: false, issues: [{ path: "picks", message: "must be a non-empty array" }] };
    }

    const issues: SampleSiteIssue[] = [];
    const picks: Pick[] = [];
    const seenLabels = new Set<string>();

    rawPicks.forEach((rawPick, index) => {
        const path = `picks[${index}]`;
        if (!isRecord(rawPick)) {
            issues.push({ path, message: "must be a JSON object" });
            return;
        }

        const pickData = rawPick as RawSampleSitePick;
        const label = readLabel(pickData.id, `${path}.id`, issues);
        if (label !== undefined) {
            if (seenLabels.has(label)) {
                issues.push({ path: `${path}.id`, message: `duplicate pick id "${label}"` });
            }
            seenLabels.add(label);
        }

        const loadT = readLoad(pickData.load_t, `${path}.load_t`, issues);
        const supply = readPoint(pickData.from_xy, `${path}.from_xy`, issues);
        const drop = readPoint(pickData.to_xy, `${path}.to_xy`, issues);

        if (label !== undefined && loadT !== undefined && supply !== undefined && drop !== undefined) {
            picks.push({ label, loadT, supply, drop });
        }
    });

    if (issues.length > 0) {
        return { ok: false, issues };
    }

    return { ok: true, picks };
}

/**
 * Load the bundled sample-site snapshot. The import is static so the plugin
 * build carries exactly the same file the other sample-site fixtures use.
 */
export function loadSampleSitePicks(): SampleSiteParseResult {
    return parseSampleSitePicks(sampleSiteData);
}
