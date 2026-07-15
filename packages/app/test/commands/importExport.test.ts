// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { getCurrentApplication, setCurrentApplication } from "@chili3d/core";
import { describe, expect, test } from "@rstest/core";
import { Export, Import } from "../../src/commands/importExport";
import { createMockApplication } from "../_helpers";

// Ensure a mock application is set (Export constructor calls getCurrentApplication)
try {
    getCurrentApplication();
} catch {
    setCurrentApplication(createMockApplication());
}

describe("Import", () => {
    test("should have command metadata", () => {
        const data = (Import as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("file.import");
        expect(data.icon).toBe("icon-import");
    });
});

describe("Export", () => {
    test("should have command metadata", () => {
        const data = (Export as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("file.export");
        expect(data.icon).toBe("icon-export");
    });

    test("format should default to '.step'", () => {
        const cmd = new Export();
        expect(cmd.format).toBe(".step");
    });

    test("format setter should update property", () => {
        const cmd = new Export();
        cmd.format = ".stl";
        expect(cmd.format).toBe(".stl");

        cmd.format = ".step";
        expect(cmd.format).toBe(".step");
    });
});
