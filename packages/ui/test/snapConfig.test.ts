// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";

// Mock CSS modules
rs.mock("../src/statusbar/snapConfig.module.css", () => ({
    container: "sc-container",
}));

// Mock element helpers
// biome-ignore lint/suspicious/noExplicitAny: test mock for DOM element factory
rs.mock("@chili3d/element", () => ({
    div: (...children: any[]) => {
        const el = document.createElement("div");
        for (const c of children) {
            if (c instanceof Node) el.appendChild(c);
        }
        return el;
    },
    input: (props: any) => {
        const el = document.createElement("input");
        if (props && typeof props === "object") {
            if (props.type) el.type = props.type;
            if (props.id) el.id = props.id;
            if (props.checked !== undefined) el.checked = props.checked;
            if (props.onclick) el.onclick = props.onclick;
        }
        return el;
    },
    label: (props: any) => {
        const el = document.createElement("label");
        if (props && typeof props === "object") {
            if (props.htmlFor) el.htmlFor = props.htmlFor;
            if (props.textContent !== undefined) el.textContent = String(props.textContent);
        }
        return el;
    },
}));

import { SnapConfig } from "../src/statusbar/snapConfig";

describe("SnapConfig", () => {
    let originalSnapType: ObjectSnapType;
    let originalEnableSnap: boolean;
    let originalEnableSnapTracking: boolean;

    beforeEach(() => {
        originalSnapType = Config.instance.snapType;
        originalEnableSnap = Config.instance.enableSnap;
        originalEnableSnapTracking = Config.instance.enableSnapTracking;

        // Set defaults for consistent testing
        Config.instance.enableSnap = true;
        Config.instance.enableSnapTracking = true;
    });

    afterEach(() => {
        Config.instance.snapType = originalSnapType;
        Config.instance.enableSnap = originalEnableSnap;
        Config.instance.enableSnapTracking = originalEnableSnapTracking;
    });

    describe("constructor", () => {
        test("should render snap type checkboxes", () => {
            const config = new SnapConfig();
            const checkboxes = config.querySelectorAll('input[type="checkbox"]');
            // 8 snap types + 1 tracking toggle = 9 checkboxes
            expect(checkboxes.length).toBe(9);
        });

        test("should set container CSS class", () => {
            const config = new SnapConfig();
            expect(config.className).toContain("sc-container");
        });

        test("should create checkboxes with id prefix snap-", () => {
            const config = new SnapConfig();
            const snapCheckboxes = config.querySelectorAll('input[id^="snap-"]');
            // 9 total checkboxes, all should start with snap- prefix
            expect(snapCheckboxes.length).toBe(9);
        });

        test("should create tracking checkbox", () => {
            const config = new SnapConfig();
            const trackingCheckbox = config.querySelector("#snap-tracking") as HTMLInputElement;
            expect(trackingCheckbox).not.toBeNull();
            expect(trackingCheckbox.checked).toBe(true);
        });

        test("should render labels for each checkbox", () => {
            const config = new SnapConfig();
            const labels = config.querySelectorAll("label");
            // 8 snap type labels + 1 tracking label = 9
            expect(labels.length).toBe(9);
        });
    });

    describe("snap type toggling", () => {
        test("should toggle snap type when checkbox clicked", () => {
            const config = new SnapConfig();
            // SnapTypes[i].type is a numeric enum value, so the id format is snap-{number}
            const endPointId = `snap-${ObjectSnapTypes.endPoint}`;
            const endPointCheckbox = config.querySelector(`#${endPointId}`) as HTMLInputElement;
            expect(endPointCheckbox).not.toBeNull();

            const hadType = ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.endPoint);

            endPointCheckbox.click();

            const nowHasType = ObjectSnapTypeUtils.hasType(
                Config.instance.snapType,
                ObjectSnapTypes.endPoint,
            );

            // After clicking, the type should toggle
            expect(nowHasType).toBe(!hadType);
        });
    });

    describe("tracking toggle", () => {
        test("should toggle enableSnapTracking when tracking checkbox is clicked", () => {
            Config.instance.enableSnapTracking = true;
            const config = new SnapConfig();
            const trackingCheckbox = config.querySelector("#snap-tracking") as HTMLInputElement;
            trackingCheckbox.click();
            expect(Config.instance.enableSnapTracking).toBe(false);
        });
    });

    describe("config change reactivity", () => {
        test("should re-render when snapType config changes", () => {
            const config = new SnapConfig();
            const oldType = Config.instance.snapType;
            Config.instance.snapType = ObjectSnapTypeUtils.addType(
                oldType,
                ObjectSnapTypes.center as ObjectSnapType,
            );
            // Manually trigger the property changed callback
            (config as unknown as { snapTypeChanged: (prop: string) => void }).snapTypeChanged("snapType");

            // Content should be regenerated
            expect(config.querySelectorAll('input[type="checkbox"]').length).toBe(9);
        });

        test("should re-render when enableSnap config changes", () => {
            const config = new SnapConfig();
            (config as unknown as { snapTypeChanged: (prop: string) => void }).snapTypeChanged("enableSnap");
            expect(config.querySelectorAll('input[type="checkbox"]').length).toBe(9);
        });

        test("should re-render when enableSnapTracking config changes", () => {
            const config = new SnapConfig();
            (config as unknown as { snapTypeChanged: (prop: string) => void }).snapTypeChanged(
                "enableSnapTracking",
            );
            expect(config.querySelectorAll('input[type="checkbox"]').length).toBe(9);
        });

        test("should NOT clear checkboxes for unrelated config changes", () => {
            const config = new SnapConfig();
            (config as unknown as { snapTypeChanged: (prop: string) => void }).snapTypeChanged("language");
            // The snapTypeChanged method only clears on snapType/enableSnap/enableSnapTracking
            // For "language", innerHTML should NOT have been cleared
            expect(config.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
        });
    });
});
