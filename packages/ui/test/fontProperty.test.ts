// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type DialogButton,
    FontCatalog,
    type I18nKeys,
    type IDocument,
    type Property,
    PubSub,
    Result,
} from "@chili3d/core";
import { createMockDocument } from "@chili3d/core/test-utils";
import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";

rs.mock("../src/property/fontProperty.module.css", () => ({
    root: "fp-root",
    font: "fp-font",
    current: "fp-current",
    add: "fp-add",
}));

// Real events, so the row is driven through `click()` rather than an `_onclick` hook.
import "./_helpers/mockElementRealEvents";

import { FontProperty } from "../src/property/fontProperty";
import { mustQuery } from "./_helpers/domHelpers";

const display = "font.select" as I18nKeys;
const property = { name: "fontName", display } as Property;

/** A text holder that records what it was asked to draw itself in. */
function holder(fontName: string, outcome = true) {
    return {
        fontName,
        useFont: rs.fn(async (_font: { name: string; url?: string }) =>
            outcome ? Result.ok(undefined) : Result.err("no"),
        ),
    };
}

/**
 * The picker is driven for real rather than stubbed: the row opens it, and this
 * answers the dialog the way a person would — choosing a font, or cancelling.
 */
let answer: (content: HTMLElement, buttons: DialogButton[]) => void;
const answerDialog = (_title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => {
    answer(content, (buttons as DialogButton[]) ?? []);
};

/** Let the click handler's `await`s run to completion. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

let document: IDocument;

beforeEach(() => {
    document = createMockDocument();
    answer = () => {};
    PubSub.default.sub("showDialog", answerDialog);
});

afterEach(() => {
    PubSub.default.remove("showDialog", answerDialog);
});

describe("FontProperty", () => {
    test("names the font the text is already in", () => {
        const control = new FontProperty(document, [holder("Roboto")], property);

        expect(mustQuery(control, ".fp-font").textContent).toBe("Roboto");
    });

    test("draws the text again in the font chosen from the picker", async () => {
        const roboto = FontCatalog[0];
        answer = (content, buttons) => {
            (mustQuery(content, "select") as HTMLSelectElement).value = roboto.url;
            buttons[0].onclick?.();
        };
        const text = holder("Roboto");
        const control = new FontProperty(document, [text], property);

        mustQuery(control, ".fp-font").click();
        await settled();

        expect(text.useFont.mock.calls.length).toBe(1);
        expect(text.useFont.mock.calls[0][0]).toEqual({ name: roboto.family, url: roboto.url });
    });

    test("sets every selected text in the same font", async () => {
        answer = (content, buttons) => {
            (mustQuery(content, "select") as HTMLSelectElement).value = FontCatalog[0].url;
            buttons[0].onclick?.();
        };
        const first = holder("Roboto");
        const second = holder("Roboto");
        const control = new FontProperty(document, [first, second], property);

        mustQuery(control, ".fp-font").click();
        await settled();

        expect(first.useFont.mock.calls[0][0]).toEqual(second.useFont.mock.calls[0][0]);
    });

    test("an object that cannot draw itself again still takes the name", async () => {
        answer = (content, buttons) => {
            (mustQuery(content, "select") as HTMLSelectElement).value = FontCatalog[0].url;
            buttons[0].onclick?.();
        };
        const plain = { fontName: "Roboto" };
        const control = new FontProperty(document, [plain], property);

        mustQuery(control, ".fp-font").click();
        await settled();

        expect(plain.fontName).toBe(FontCatalog[0].family);
    });

    test("leaves everything alone when the picker is cancelled", async () => {
        answer = (_content, buttons) => buttons[2].onclick?.();
        const text = holder("Roboto");
        const control = new FontProperty(document, [text], property);

        mustQuery(control, ".fp-font").click();
        await settled();

        expect(text.useFont.mock.calls.length).toBe(0);
        expect(text.fontName).toBe("Roboto");
    });

    test("a font that could not be applied is reported to the user", async () => {
        answer = (content, buttons) => {
            (mustQuery(content, "select") as HTMLSelectElement).value = FontCatalog[0].url;
            buttons[0].onclick?.();
        };
        const text = holder("Roboto", false);
        const control = new FontProperty(document, [text], property);
        const published = rs.spyOn(PubSub.default, "pub");

        mustQuery(control, ".fp-font").click();
        await settled();

        const reports = published.mock.calls.filter((call) => call[0] === "showToast");
        expect(reports.length).toBe(1);
        expect(reports[0][1]).toBe("toast.text.fontUnavailable");

        published.mockRestore();
    });
});
