// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "@chili3d/core";
import { beforeEach, describe, expect, test } from "@rstest/core";

rs.mock("../src/statusbar/snapConfig.module.css", () => ({
    container: "sc-container",
    snapGroup: "sc-snap-group",
    summary: "sc-summary",
    popup: "sc-popup",
    item: "sc-item",
    toggle: "sc-toggle",
}));

import "./_helpers/mockElementRealEvents";

import { SnapConfig } from "../src/statusbar/snapConfig";
import { mustQuery } from "./_helpers/domHelpers";

function openConfig() {
    const config = new SnapConfig();
    const host = document.createElement("div");
    host.append(config);
    document.body.append(host);
    const summary = mustQuery<HTMLButtonElement>(config, ".sc-summary");
    summary.click();
    const popup = mustQuery(document.body, ".sc-popup");
    return { config, host, summary, popup };
}

describe("SnapConfig", () => {
    let originalSnapType: ObjectSnapType;
    let originalEnableSnap: boolean;
    let originalEnableSnapTracking: boolean;

    beforeEach(() => {
        originalSnapType = Config.instance.snapType;
        originalEnableSnap = Config.instance.enableSnap;
        originalEnableSnapTracking = Config.instance.enableSnapTracking;
        Config.instance.enableSnap = true;
        Config.instance.enableSnapTracking = true;
    });

    afterEach(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        document.body.replaceChildren();
        Config.instance.snapType = originalSnapType;
        Config.instance.enableSnap = originalEnableSnap;
        Config.instance.enableSnapTracking = originalEnableSnapTracking;
        rs.unstubAllGlobals();
    });

    test("renders snap and tracking toggles with the config collapsed", () => {
        const config = new SnapConfig();
        document.body.append(config);

        expect(config.className).toContain("sc-container");
        expect(config.querySelectorAll("button").length).toBe(1);
        expect(config.querySelectorAll("input").length).toBe(2);
        const enabled = mustQuery<HTMLInputElement>(config, "#snap-enabled");
        const tracking = mustQuery<HTMLInputElement>(config, "#snap-tracking");
        expect(enabled.checked).toBe(true);
        expect(tracking.checked).toBe(true);
        const snapLabel = mustQuery<HTMLLabelElement>(config, 'label[for="snap-enabled"]');
        const trackingLabel = mustQuery<HTMLLabelElement>(config, 'label[for="snap-tracking"]');
        expect(snapLabel.contains(enabled)).toBe(true);
        expect(trackingLabel.contains(tracking)).toBe(true);
        expect(document.body.querySelector(".sc-popup")).toBeNull();
        const summary = mustQuery(config, ".sc-summary");
        expect(summary.getAttribute("aria-expanded")).toBe("false");
        expect(summary.hasAttribute("aria-label")).toBe(true);
    });

    test("opens all snap options above the summary button", () => {
        const config = new SnapConfig();
        document.body.append(config);
        const summary = mustQuery<HTMLButtonElement>(config, ".sc-summary");
        summary.getBoundingClientRect = () => ({ right: 720, top: 760 }) as DOMRect;

        summary.click();

        const popup = mustQuery(document.body, ".sc-popup");
        expect(popup.querySelectorAll('input[type="checkbox"]').length).toBe(8);
        expect(popup.querySelectorAll('input[id^="snap-"]').length).toBe(8);
        expect(popup.querySelectorAll("label").length).toBe(8);
        expect(summary.getAttribute("aria-expanded")).toBe("true");
        expect(popup.style.right).toBe(`${window.innerWidth - 720}px`);
        expect(popup.style.bottom).toBe(`${window.innerHeight - 760 + 4}px`);
        expect(popup.style.maxHeight).toBe("752px");
    });

    test("toggles snap types repeatedly without closing the popup", () => {
        const { popup } = openConfig();
        const checkbox = mustQuery<HTMLInputElement>(popup, `#snap-${ObjectSnapTypes.endPoint}`);
        const hadType = ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.endPoint);

        checkbox.click();

        expect(ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.endPoint)).toBe(
            !hadType,
        );
        expect(mustQuery(document.body, ".sc-popup")).toBe(popup);

        checkbox.click();

        expect(ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.endPoint)).toBe(hadType);
        expect(mustQuery(document.body, ".sc-popup")).toBe(popup);
    });

    test("toggles object snap without changing its types or tracking", () => {
        const config = new SnapConfig();
        document.body.append(config);
        const enabled = mustQuery<HTMLInputElement>(config, "#snap-enabled");
        const snapType = Config.instance.snapType;
        expect(enabled.checked).toBe(true);

        enabled.click();

        expect(Config.instance.enableSnap).toBe(false);
        expect(Config.instance.snapType).toBe(snapType);
        expect(Config.instance.enableSnapTracking).toBe(true);
        expect(document.body.querySelector(".sc-popup")).toBeNull();
    });

    test("toggles tracking from the statusbar control", () => {
        const config = new SnapConfig();
        document.body.append(config);
        const tracking = mustQuery<HTMLInputElement>(config, "#snap-tracking");
        expect(tracking.checked).toBe(true);

        tracking.click();

        expect(Config.instance.enableSnapTracking).toBe(false);
        expect(document.body.querySelector(".sc-popup")).toBeNull();
    });

    test("closes when the summary button is clicked again", () => {
        const { summary } = openConfig();

        summary.click();

        expect(document.body.querySelector(".sc-popup")).toBeNull();
        expect(summary.getAttribute("aria-expanded")).toBe("false");
    });

    test("closes on an outside pointer down", () => {
        openConfig();
        const outside = document.createElement("div");
        document.body.append(outside);

        outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));

        expect(document.body.querySelector(".sc-popup")).toBeNull();
    });

    test("closes on Escape without forwarding it to global handlers", () => {
        const { summary } = openConfig();
        const globalKeyDown = rs.fn();
        window.addEventListener("keydown", globalKeyDown);
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

        try {
            summary.dispatchEvent(event);

            expect(document.body.querySelector(".sc-popup")).toBeNull();
            expect(event.defaultPrevented).toBe(true);
            expect(globalKeyDown).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener("keydown", globalKeyDown);
        }
    });

    test("closes and removes listeners when disconnected", () => {
        const { config } = openConfig();
        const remove = rs.spyOn(Config.instance, "removePropertyChanged");

        try {
            config.remove();

            expect(document.body.querySelector(".sc-popup")).toBeNull();
            expect(mustQuery(config, ".sc-summary").getAttribute("aria-expanded")).toBe("false");
            const listener = (config as unknown as { snapTypeChanged: (property: string) => void })
                .snapTypeChanged;
            expect(remove).toHaveBeenCalledWith(listener);
        } finally {
            remove.mockRestore();
        }
    });

    test("synchronizes config changes after being remounted", () => {
        const config = new SnapConfig();
        document.body.append(config);
        const enabled = mustQuery<HTMLInputElement>(config, "#snap-enabled");
        const tracking = mustQuery<HTMLInputElement>(config, "#snap-tracking");
        config.remove();
        Config.instance.enableSnap = false;
        Config.instance.enableSnapTracking = false;

        document.body.append(config);

        expect(enabled.checked).toBe(false);
        expect(tracking.checked).toBe(false);
    });

    test("repositions the popup when its statusbar container resizes", () => {
        let callback: ResizeObserverCallback | undefined;
        let observed: Element | undefined;
        const disconnect = rs.fn();
        rs.stubGlobal(
            "ResizeObserver",
            class {
                constructor(onResize: ResizeObserverCallback) {
                    callback = onResize;
                }
                observe(target: Element) {
                    observed = target;
                }
                disconnect() {
                    disconnect();
                }
            },
        );
        const { config, host, summary, popup } = openConfig();
        let right = 720;
        summary.getBoundingClientRect = () => ({ right, top: 760 }) as DOMRect;
        expect(callback).toBeDefined();
        expect(observed).toBe(host);
        if (callback === undefined) throw new Error("ResizeObserver callback was not registered");

        callback([], {} as ResizeObserver);
        expect(popup.style.right).toBe(`${window.innerWidth - 720}px`);
        right = 640;
        callback([], {} as ResizeObserver);

        expect(popup.style.right).toBe(`${window.innerWidth - 640}px`);
        config.remove();
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    test("synchronizes open checkboxes when config changes", () => {
        const { config, popup } = openConfig();
        const endpoint = mustQuery<HTMLInputElement>(popup, `#snap-${ObjectSnapTypes.endPoint}`);
        const enabled = mustQuery<HTMLInputElement>(config, "#snap-enabled");
        const tracking = mustQuery<HTMLInputElement>(config, "#snap-tracking");
        const hadType = ObjectSnapTypeUtils.hasType(Config.instance.snapType, ObjectSnapTypes.endPoint);

        Config.instance.snapType = hadType
            ? ObjectSnapTypeUtils.removeType(Config.instance.snapType, ObjectSnapTypes.endPoint)
            : ObjectSnapTypeUtils.addType(Config.instance.snapType, ObjectSnapTypes.endPoint);
        Config.instance.enableSnap = false;
        Config.instance.enableSnapTracking = false;

        expect(endpoint.checked).toBe(!hadType);
        expect(enabled.checked).toBe(false);
        expect(tracking.checked).toBe(false);
        expect(mustQuery(document.body, `input#snap-${ObjectSnapTypes.endPoint}`)).toBe(endpoint);

        (config as unknown as { snapTypeChanged: (property: string) => void }).snapTypeChanged("language");
        expect(mustQuery(document.body, `input#snap-${ObjectSnapTypes.endPoint}`)).toBe(endpoint);
    });
});
