import { type IConverter, Result } from "chili-core";

export class BendTypeConverter implements IConverter<number> {
    convert(value: number): Result<string> {
        // Handle sentinel values gracefully
        if (value === -1) return Result.ok("Native");
        if (value === 0) return Result.ok("Custom");

        // Standard numeric formatting
        // Remove trailing zeros for cleanliness if needed, but String(value) does a decent job
        return Result.ok(`${value} D`);
    }

    convertBack(value: string): Result<number> {
        if (!value) return Result.err("Empty value");
        const lower = value.trim().toLowerCase();

        // Handle specific keywords
        if (lower === "native") return Result.ok(-1);
        if (lower === "custom") return Result.ok(0);

        // Remove "d" and whitespace
        // e.g. "1.5 D" -> "1.5"
        const clean = lower.replace(/[d\s]/g, "");

        const n = Number(clean);
        if (Number.isNaN(n)) {
            return Result.err("Invalid number");
        }
        return Result.ok(n);
    }
}
