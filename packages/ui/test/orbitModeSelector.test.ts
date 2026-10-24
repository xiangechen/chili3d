// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// biome-ignore assist/source/organizeImports: import order is load-bearing — the core-mock helper must load before core value imports and the module under test
import { beforeEach, describe, expect, test } from "@rstest/core";

// Mock element helpers and core services (Config stub; OrbitModes stays real)
import "./_helpers/mockElement";
import { configStub } from "./_helpers/mockCoreConfig";

// Core value imports must come AFTER the mock helper — importing them earlier
// would load the real "@chili3d/core" before the mock registers.
import { OrbitModes } from "@chili3d/core";
import { OrbitModeSelector } from "../src/home/orbitModeSelector";

describe("OrbitModeSelector", () => {
    beforeEach(() => {
        configStub.orbitMode = "turntable";
    });

    function getOnChange(selector: HTMLElement) {
        const onchange = (selector as unknown as { _onchange?: (e: Event) => void })._onchange;
        expect(onchange).toBeDefined();
        return onchange!;
    }

    test("should render an option per orbit mode", () => {
        const selector = OrbitModeSelector({});
        expect(selector.tagName).toBe("SELECT");

        const options = selector.querySelectorAll("option");
        expect(options.length).toBe(OrbitModes.length);
        expect((options[0] as HTMLOptionElement).value).toBe("turntable");
        expect((options[1] as HTMLOptionElement).value).toBe("trackball");
    });

    test("should mark the current orbit mode as selected", () => {
        configStub.orbitMode = "trackball";
        const selector = OrbitModeSelector({});

        // Happy-DOM scrambles option.selected when several options are appended — assert the
        // raw flag the element mock records, as the sibling selectors' tests do.
        const options = selector.querySelectorAll("option");
        expect((options[0] as unknown as { _selected: boolean })._selected).toBe(false);
        expect((options[1] as unknown as { _selected: boolean })._selected).toBe(true);
    });

    test("should set Config orbit mode on change", () => {
        const selector = OrbitModeSelector({});

        getOnChange(selector)({ target: { value: "trackball" } } as unknown as Event);

        expect(configStub.orbitMode).toBe("trackball");
    });

    test("should forward extra props to the select element", () => {
        const selector = OrbitModeSelector({ className: "home-orbit" });
        expect(selector.className).toBe("home-orbit");
    });
});
