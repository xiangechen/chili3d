// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";

// Mock CSS module under test
rs.mock("../src/statusbar/statusbar.module.css", () => ({
    panel: "sb-panel",
    tip: "sb-tip",
    left: "sb-left",
    right: "sb-right",
}));

// SnapConfig pulls in the whole snap checkbox stack — replace it with a plain stub;
// it has its own test file (snapConfig.test.ts).
rs.mock("../src/statusbar/snapConfig", () => ({
    SnapConfig: class {},
}));

// Recorded collaborators for the core mock. Factories may only reference
// rs.hoisted-created values.
const pubSubRecorder = rs.hoisted(() => {
    const { createPubSubRecorder } = require("./_helpers/coreMocks");
    return createPubSubRecorder();
});

const i18nSetMock = rs.hoisted(() => rs.fn());

const configChanged = rs.hoisted(() => {
    const handlers = new Set<(prop: string) => void>();
    return {
        instance: {
            onPropertyChanged: (h: (prop: string) => void) => handlers.add(h),
        },
        emit: (prop: string) => handlers.forEach((h) => h(prop)),
        clear: () => handlers.clear(),
    };
});

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    return {
        ...actual,
        Config: { instance: configChanged.instance },
        I18n: { set: i18nSetMock },
        Navigation3D: {
            navigationKeyMap: () => ({ pan: "Middle", rotate: "Shift+Middle" }),
        },
        PubSub: pubSubRecorder.stub,
    };
});

// Mock element helpers
import "./_helpers/mockElement";

import type { I18nKeys } from "@chili3d/core";
import { Statusbar } from "../src/statusbar/statusbar";
import { mustQuery } from "./_helpers/domHelpers";

const DEFAULT_TIP_ARGS = ["textContent", "prompt.default{0}{1}", "Middle", "Shift+Middle"];

describe("Statusbar", () => {
    beforeEach(() => {
        pubSubRecorder.reset();
        i18nSetMock.mockClear();
        // handlers accumulate per constructed Statusbar — drop stale instances
        configChanged.clear();
    });

    describe("constructor", () => {
        test("should set panel class with the provided className", () => {
            const bar = new Statusbar("test-bar");
            expect(bar.className).toBe("sb-panel test-bar");
        });

        test("should set the default tip from the navigation key map", () => {
            const bar = new Statusbar("test-bar");
            expect(i18nSetMock).toHaveBeenCalledWith(bar.tip, ...DEFAULT_TIP_ARGS);
        });

        test("should render the tip label in the left section", () => {
            const bar = new Statusbar("test-bar");
            const left = mustQuery(bar, ".sb-left");
            expect(left.contains(bar.tip)).toBe(true);
            mustQuery(bar, ".sb-right");
        });

        test("should subscribe to statusBarTip and clearStatusBarTip", () => {
            new Statusbar("test-bar");
            expect(pubSubRecorder.handlers.has("statusBarTip")).toBe(true);
            expect(pubSubRecorder.handlers.has("clearStatusBarTip")).toBe(true);
        });
    });

    describe("tip updates", () => {
        test("should show the published tip and restore the default on clear", () => {
            const bar = new Statusbar("test-bar");
            i18nSetMock.mockClear();

            const tipHandler = pubSubRecorder.handlers.get("statusBarTip");
            expect(tipHandler).toBeDefined();
            tipHandler!("command.create.box" as I18nKeys);
            expect(i18nSetMock).toHaveBeenCalledWith(bar.tip, "textContent", "command.create.box");

            const clearHandler = pubSubRecorder.handlers.get("clearStatusBarTip");
            expect(clearHandler).toBeDefined();
            clearHandler!();
            expect(i18nSetMock).toHaveBeenCalledWith(bar.tip, ...DEFAULT_TIP_ARGS);
        });

        test("should forward tip arguments to I18n.set", () => {
            const bar = new Statusbar("test-bar");
            i18nSetMock.mockClear();

            const tipHandler = pubSubRecorder.handlers.get("statusBarTip");
            expect(tipHandler).toBeDefined();
            tipHandler!("sketch.dofs{0}" as I18nKeys, 3);
            expect(i18nSetMock).toHaveBeenCalledWith(bar.tip, "textContent", "sketch.dofs{0}", 3);
        });

        test("should refresh the default tip when navigation3D config changes", () => {
            const bar = new Statusbar("test-bar");
            i18nSetMock.mockClear();

            configChanged.emit("navigation3D");

            expect(i18nSetMock).toHaveBeenCalledWith(bar.tip, ...DEFAULT_TIP_ARGS);
        });

        test("should keep a custom tip when navigation3D config changes", () => {
            new Statusbar("test-bar");
            const tipHandler = pubSubRecorder.handlers.get("statusBarTip");
            expect(tipHandler).toBeDefined();
            tipHandler!("command.create.box" as I18nKeys);
            i18nSetMock.mockClear();

            configChanged.emit("navigation3D");

            // the tip is no longer the default one — config change must not reset it
            expect(i18nSetMock).not.toHaveBeenCalled();
        });

        test("should ignore unrelated config changes", () => {
            new Statusbar("test-bar");
            i18nSetMock.mockClear();

            configChanged.emit("language");

            expect(i18nSetMock).not.toHaveBeenCalled();
        });
    });
});
