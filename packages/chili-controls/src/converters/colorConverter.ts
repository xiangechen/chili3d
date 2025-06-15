// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter, Result } from "chili-core";

export class ColorConverter implements IConverter<number | string> {
    convert(value: number | string): Result<string> {
        // Handle undefined, null, or invalid values
        if (value === undefined || value === null) {
            return Result.ok("#808080"); // Default gray color
        }

        if (typeof value === "string") {
            // If it's already a valid hex string, return it
            if (value.startsWith("#") && /^#[0-9A-Fa-f]{6}$/.test(value)) {
                return Result.ok(value);
            }
            // If it's a hex string without #, add it
            if (/^[0-9A-Fa-f]{6}$/.test(value)) {
                return Result.ok(`#${value}`);
            }
            // If it's an empty string or invalid, use default
            return Result.ok("#808080");
        }

        if (typeof value === "number" && !isNaN(value)) {
            return Result.ok(`#${value.toString(16).padStart(6, "0")}`);
        }

        // Fallback for any other invalid values
        return Result.ok("#808080");
    }

    convertBack(value: string): Result<number> {
        const hexValue = value.startsWith("#") ? value.substring(1) : value;
        const result = parseInt(hexValue, 16);
        return Number.isNaN(result) ? Result.err(`Invalid hex string: ${value}`) : Result.ok(result);
    }
}
