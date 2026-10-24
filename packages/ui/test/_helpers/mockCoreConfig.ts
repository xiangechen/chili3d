// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Registers the shared `@chili3d/core` mock for the home selector tests: mutable
// Config/I18n stubs backed by the exported `configStub` / `languageList`, plus the
// Localize stub. `Navigation3DTypes` and `OrbitModes` stay the real arrays from core.
// Import this module BEFORE the module under test.

// Type-only, so it is erased before the mock below registers and never loads the real module.
import type { OrbitMode } from "@chili3d/core";
import { rs } from "@rstest/core";

/** Mutable Config stub — reset the fields between tests. */
export const configStub = rs.hoisted(() => ({
    language: "en",
    themeMode: "system" as "light" | "dark" | "system",
    navigation3D: "Chili3d",
    orbitMode: "turntable" as OrbitMode,
}));

/** Mutable language list backing the I18n stub. */
export const languageList = rs.hoisted(() => [
    { display: "English", language: "en" },
    { display: "中文", language: "zh-CN" },
]);

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { LocalizeMock } = rs.hoisted(() => require("./coreMocks"));
    // `...actual` only contains real exports when the real core module was already
    // loaded — pull the real Navigation3DTypes directly so it always works.
    const { Navigation3DTypes } = rs.hoisted(() => require("@chili3d/core/src/navigation"));
    const { OrbitModes } = rs.hoisted(() => require("@chili3d/core/src/config"));
    return {
        ...actual,
        Navigation3DTypes,
        OrbitModes,
        Localize: LocalizeMock,
        Config: { instance: configStub },
        I18n: {
            getLanguages: () => languageList,
            currentLanguage: () => configStub.language,
        },
    };
});
