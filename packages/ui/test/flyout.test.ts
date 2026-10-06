// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub, Result } from "@chili3d/core";
import { afterEach, describe, expect, test } from "@rstest/core";
import { Flyout } from "../src/viewport/flyout/flyout";
import { mustQuery } from "./_helpers/domHelpers";

describe("Flyout input", () => {
    afterEach(() => {
        // tearing the element out disconnects it, which unsubscribes its PubSub handlers
        document.body.replaceChildren();
    });

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    function flyout(): Flyout {
        const element = new Flyout();
        document.body.append(element);
        return element;
    }

    test("takes the keyboard focus by default", async () => {
        flyout();
        PubSub.default.pub("showInput", "5", () => Result.ok("5"));
        await tick();

        expect(document.activeElement?.tagName).toBe("INPUT");
    });

    test("leaves the focus where it is for a readout", async () => {
        flyout();
        PubSub.default.pub("showInput", "5", () => Result.ok("5"), { selectAll: true, takeFocus: false });
        await tick();

        // a box riding a drag only reports: the keys stay with the drag, so Enter still
        // confirms the gesture instead of being swallowed here
        expect(document.activeElement?.tagName).not.toBe("INPUT");
    });

    test("reports the box coming down, however it comes down", async () => {
        const element = flyout();
        let closed = 0;
        const onClose = () => closed++;

        // confirmed with Enter
        PubSub.default.pub("showInput", "5", () => Result.ok("5"), { onClose });
        await tick();
        mustQuery<HTMLInputElement>(element, "input").dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        expect(closed).toBe(1);

        // cancelled with Escape
        PubSub.default.pub("showInput", "6", () => Result.ok("6"), { onClose });
        await tick();
        mustQuery<HTMLInputElement>(element, "input").dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        expect(closed).toBe(2);

        // or cleared from outside, as an abandoned gesture does
        PubSub.default.pub("showInput", "7", () => Result.ok("7"), { onClose });
        await tick();
        PubSub.default.pub("clearInput");
        expect(closed).toBe(3);
    });

    test("replaces a box that is already up, telling the old one through its onClose", async () => {
        const element = flyout();
        let closed = 0;
        PubSub.default.pub("showInput", "first", () => Result.ok("first"), { onClose: () => closed++ });
        await tick();

        // a digit opening the numeric box over a drag's lingering readout, say: the newer
        // request is the intent, and the box it replaces hears about it
        PubSub.default.pub("showInput", "second", () => Result.ok("second"));
        await tick();

        expect(closed).toBe(1);
        expect(element.querySelectorAll("input")).toHaveLength(1);
        expect(mustQuery<HTMLInputElement>(element, "input").value).toBe("second");
    });
});
