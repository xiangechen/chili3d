// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Result } from "@chili3d/core";
import { REQUIRED_DISCLAIMER, type SiteProject } from "./types";

/**
 * Validates whether an object adheres to the SiteProject v1 schema.
 */
export function validateSiteProject(data: unknown): Result<SiteProject, string> {
    if (!data || typeof data !== "object") {
        return Result.err("Invalid project data: root must be an object");
    }

    const proj = data as Partial<SiteProject>;

    if (proj.schema_version !== "1.0") {
        return Result.err("Invalid schema_version: expected '1.0'");
    }

    if (proj.units !== "m") {
        return Result.err("Invalid units: expected 'm'");
    }

    if (!proj.boundary?.polygon || proj.boundary.polygon.length < 3) {
        return Result.err("Invalid boundary: must include closed polygon with at least 3 points");
    }

    if (!proj.buildings || typeof proj.buildings !== "object") {
        return Result.err("Invalid buildings: must be a record of buildings");
    }

    // Verify mandatory disclaimer
    if (!proj.disclaimer?.includes("Planning aid, not a certified lift plan.")) {
        return Result.err(`Missing mandatory disclaimer: '${REQUIRED_DISCLAIMER}' must be present.`);
    }

    return Result.ok(proj as SiteProject);
}

/**
 * Saves a SiteProject object to a formatted JSON string.
 */
export function saveProjectJson(project: SiteProject): string {
    // Ensure disclaimer is always present before saving
    if (!project.disclaimer) {
        project.disclaimer = REQUIRED_DISCLAIMER;
    }
    return JSON.stringify(project, null, 2);
}

/**
 * Loads and validates a SiteProject from a JSON string.
 */
export function loadProjectJson(jsonString: string): Result<SiteProject, string> {
    try {
        const parsed = JSON.parse(jsonString);
        return validateSiteProject(parsed);
    } catch (e) {
        return Result.err(`JSON parse error: ${(e as Error).message}`);
    }
}
