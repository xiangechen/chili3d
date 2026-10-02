// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AUTO_TARGETS, type TargetSelection } from "@chili3d/core";
import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { TargetList, type TargetListSource } from "../src/targetList";
import style from "../src/targetList.module.css";

/** A source whose selection the test can move, and whose subscribers it can fire. */
function source(ids: string[] = ["b1", "b2"]) {
    const written: TargetSelection[] = [];
    const handlers = new Set<() => void>();
    let selection: TargetSelection = AUTO_TARGETS;

    const list: TargetListSource = {
        candidates: () => ids.map((id) => ({ id, label: `Body ${id}` })),
        selected: () => selection,
        setSelection: (value) => written.push(value),
        subscribe: (handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
    };
    return {
        list,
        written,
        /** What the command's own detection does: move the value, then tell the control. */
        setSelection(value: TargetSelection) {
            selection = value;
            for (const handler of handlers) handler();
        },
        subscribers: () => handlers.size,
    };
}

describe("TargetList", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        for (const popup of document.body.querySelectorAll(`.${style.popup}`)) {
            popup.remove();
        }
    });

    /** The list itself hangs off the body — the panel would clip it — so it opens on a click. */
    const open = (control: TargetList) => (control.querySelector("button") as HTMLElement).click();
    const popup = () => document.body.querySelector(`.${style.popup}`) as HTMLElement | null;
    const boxes = () => [...(popup()?.querySelectorAll("input") ?? [])];
    const summary = (control: TargetList) => control.querySelector("button") as HTMLElement;

    test("the panel keeps a count, and nothing else", () => {
        const { list, setSelection } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);

        expect(summary(control).textContent).toContain("(0)");
        expect(popup()).toBeNull();

        // What the detection put in the way, without opening anything.
        setSelection({ auto: true, ids: ["b1", "b2"] });
        expect(summary(control).textContent).toContain("(2)");
    });

    test("opens one box per candidate, checked as the selection names them", () => {
        const { list, setSelection } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);
        setSelection({ auto: true, ids: ["b2"] });

        open(control);

        expect(boxes().map((box) => box.value)).toEqual(["b1", "b2"]);
        // Auto only says who owns the set: what is checked is what will be combined.
        expect(boxes().map((box) => box.checked)).toEqual([false, true]);
        expect([...popup()!.querySelectorAll("span")].map((x) => x.textContent)).toEqual([
            "Body b1",
            "Body b2",
        ]);
    });

    test("a toggle writes every box, and makes the set the user's", () => {
        const { list, written } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);
        open(control);

        boxes()[1].checked = true;
        boxes()[1].dispatchEvent(new Event("change", { bubbles: true }));

        // The whole set as the user now means it — not just the box that moved, and no longer
        // auto, since the detection must stop speaking for it.
        expect(written).toEqual([{ auto: false, ids: ["b2"] }]);
    });

    test("a command-side change redraws the count and the open list", () => {
        const { list, setSelection } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);
        open(control);

        setSelection({ auto: false, ids: ["b1", "b2"] });

        expect(summary(control).textContent).toContain("(2)");
        expect(boxes().map((box) => box.checked)).toEqual([true, true]);
    });

    test("closes on a click outside, and on Escape", () => {
        const { list } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);

        open(control);
        expect(popup()).not.toBeNull();
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        expect(popup()).toBeNull();

        open(control);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(popup()).toBeNull();
    });

    test("a click inside the list keeps it open", () => {
        const { list } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);
        open(control);

        popup()!.dispatchEvent(new Event("pointerdown", { bubbles: true }));

        expect(popup()).not.toBeNull();
    });

    test("leaving the document takes the list down and stops listening", () => {
        const { list, setSelection, subscribers } = source();
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);
        open(control);
        expect(subscribers()).toBe(1);

        control.remove();

        // The popup is not the element's child, so nothing else would take it down.
        expect(popup()).toBeNull();
        expect(subscribers()).toBe(0);
        expect(() => setSelection({ auto: false, ids: ["b1"] })).not.toThrow();
    });

    test("says so when there is no body to combine with", () => {
        const { list } = source([]);
        const control = new TargetList("option.command.targets", list);
        container.appendChild(control);

        open(control);

        expect(boxes()).toHaveLength(0);
        expect(popup()!.querySelector(`.${style.empty}`)?.textContent).not.toBe("");
    });
});
