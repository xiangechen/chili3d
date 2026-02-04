// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { SelectableItems, SelectMode } from "chili-core";
import { RadioGroup } from "../src/radioGroup";
import style from "../src/radioGroup.module.css";

describe("RadioGroup", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    test("should render radio buttons for each item", () => {
        const items = ["option1", "option2", "option3"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");
        expect(inputs.length).toBe(3);

        const labels = radioGroup.querySelectorAll("label");
        expect(labels.length).toBe(3);
    });

    test("should render correct labels for each radio button", () => {
        const items = ["apple", "banana", "cherry"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Fruit Selection", context);

        container.appendChild(radioGroup);

        const labels = radioGroup.querySelectorAll("label");
        expect(labels[0].textContent).toBe("apple");
        expect(labels[1].textContent).toBe("banana");
        expect(labels[2].textContent).toBe("cherry");
    });

    test("should mark selected item as checked", () => {
        const items = ["option1", "option2", "option3"];
        const context = new SelectableItems(items, SelectMode.radio, ["option2"]);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");
        expect(inputs[0].checked).toBe(false);
        expect(inputs[1].checked).toBe(true);
        expect(inputs[2].checked).toBe(false);
    });

    test("should update selection when radio button is clicked", () => {
        const items = ["option1", "option2", "option3"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");
        inputs[2].click();

        expect(context.selectedItems.has("option3")).toBe(true);
        expect(inputs[0].checked).toBe(false);
        expect(inputs[1].checked).toBe(false);
        expect(inputs[2].checked).toBe(true);
    });

    test("should update visual checked state when selection changes", () => {
        const items = ["option1", "option2", "option3"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");

        inputs[0].click();
        expect(inputs[0].checked).toBe(true);
        expect(inputs[1].checked).toBe(false);
        expect(inputs[2].checked).toBe(false);

        inputs[2].click();
        expect(inputs[0].checked).toBe(false);
        expect(inputs[1].checked).toBe(false);
        expect(inputs[2].checked).toBe(true);
    });

    test("should not change selection when clicking non-radio element", () => {
        const items = ["option1", "option2"];
        const context = new SelectableItems(items, SelectMode.radio, ["option1"]);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const radioGroupDiv = radioGroup.querySelector("div");
        const event = new MouseEvent("click", { bubbles: true });
        Object.defineProperty(event, "target", {
            value: radioGroupDiv,
            configurable: true,
        });
        radioGroup.dispatchEvent(event);

        expect(context.selectedItems.has("option1")).toBe(true);
    });

    test("should uncheck all other radios when one is selected", () => {
        const items = ["option1", "option2", "option3"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");

        inputs[0].click();
        expect(inputs[0].checked).toBe(true);
        expect(inputs[1].checked).toBe(false);
        expect(inputs[2].checked).toBe(false);

        inputs[1].click();
        expect(inputs[0].checked).toBe(false);
        expect(inputs[1].checked).toBe(true);
        expect(inputs[2].checked).toBe(false);

        inputs[2].click();
        expect(inputs[0].checked).toBe(false);
        expect(inputs[1].checked).toBe(false);
        expect(inputs[2].checked).toBe(true);
    });

    test("should handle empty items array", () => {
        const items: string[] = [];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Empty Group", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");
        expect(inputs.length).toBe(0);
    });

    test("should handle single item", () => {
        const items = ["onlyOption"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Single Option", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");
        expect(inputs.length).toBe(1);
        expect(inputs[0].value).toBe("onlyOption");
    });

    test("should generate unique ids for radio buttons", () => {
        const items = ["option1", "option2", "option3"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const inputs = radioGroup.querySelectorAll("input");
        expect(inputs[0].id).toBe("radio-0");
        expect(inputs[1].id).toBe("radio-1");
        expect(inputs[2].id).toBe("radio-2");

        const labels = radioGroup.querySelectorAll("label");
        expect(labels[0].htmlFor).toBe("radio-0");
        expect(labels[1].htmlFor).toBe("radio-1");
        expect(labels[2].htmlFor).toBe("radio-2");
    });

    test("should have correct radioGroup class", () => {
        const items = ["option1", "option2"];
        const context = new SelectableItems(items);
        const radioGroup = new RadioGroup("Test Header", context);

        container.appendChild(radioGroup);

        const radioGroupDiv = radioGroup.querySelector("div");
        expect(radioGroupDiv?.className).toBe(style.radioGroup);
    });
});
