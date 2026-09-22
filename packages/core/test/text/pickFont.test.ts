// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { PubSub } from "../../src/foundation";
import type { I18nKeys } from "../../src/i18n";
import { I18n } from "../../src/i18n";
import { DefaultFont, FontCatalog } from "../../src/text/fontCatalog";
import { defaultTextFont, pickTextFont } from "../../src/text/pickFont";
import type { DialogButton } from "../../src/ui";

/**
 * The picker is driven for real rather than stubbed: these answer the dialog the
 * way a person would — choosing a row, reading a file, or cancelling.
 */
let answer: (content: HTMLElement, buttons: DialogButton[]) => void = () => {};

const answerDialog = (_title: I18nKeys, content: HTMLElement, buttons?: DialogButton[] | (() => void)) => {
    answer(content, (buttons as DialogButton[]) ?? []);
};

const selectFont = (url: string) => (content: HTMLElement, buttons: DialogButton[]) => {
    (content.querySelector("select") as HTMLSelectElement).value = url;
    buttons[0].onclick?.();
};

/** Stand in for the browser's font list, which only Chromium has. */
function stubInstalledFonts(entries: unknown[]) {
    (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts = async () => entries;
}

function installedEntry(family: string, style: string) {
    return {
        family,
        style,
        postscriptName: `${family}-${style}`,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
    };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    answer = () => {};
});

afterEach(() => {
    rs.restoreAllMocks();
    PubSub.default.remove("showDialog", answerDialog);
    delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
    for (const input of document.body.querySelectorAll("input[type=file]")) input.remove();
});

/** Subscribe for one test, then open the picker with `answer` in place. */
function openPicker() {
    PubSub.default.sub("showDialog", answerDialog);
    return pickTextFont();
}

describe("the font taken without asking", () => {
    test("is one the catalogue can actually fetch", () => {
        // A default that is not in the catalogue would be a URL nothing checks.
        expect(FontCatalog).toContain(DefaultFont);
    });

    test("covers Chinese as well as Latin", () => {
        // The default is what the first thing the user types is drawn in, and a
        // Latin-only default would silently drop every Chinese character.
        expect(defaultTextFont()).toEqual({ name: "Noto Sans SC", url: DefaultFont.url });
    });
});

describe("pickTextFont", () => {
    test("offers the catalogue, and answers with the font that was chosen", async () => {
        const roboto = FontCatalog[0];
        answer = selectFont(roboto.url);

        const picked = await openPicker();

        expect(picked.isOk).toBe(true);
        expect(picked.value).toEqual({ name: roboto.family, url: roboto.url });
    });

    test("asks for the download the catalogue font costs", async () => {
        let labels: string[] = [];
        answer = (content, buttons) => {
            labels = [...content.querySelectorAll("option")].map((option) => option.textContent ?? "");
            buttons[2].onclick?.();
        };
        await openPicker();

        // Every catalogue font is listed with its size, so an 18 MB one is no surprise.
        expect(labels.length).toBe(FontCatalog.length);
        expect(labels[0]).toBe(`${FontCatalog[0].family} (0.5 MB)`);
    });

    test("lists the fonts installed on this machine alongside them", async () => {
        stubInstalledFonts([installedEntry("PingFang SC", "Regular")]);
        // The translation data is not loaded here, so the translator is what says a label was
        // asked for rather than spelled out.
        rs.spyOn(I18n, "translate").mockImplementation((key) => `[${String(key)}]`);
        let groups: string[] = [];
        answer = (content, buttons) => {
            groups = [...content.querySelectorAll("optgroup")].map((group) => group.label);
            buttons[2].onclick?.();
        };
        await openPicker();

        // The keys are translated rather than shown: a group headed "font.groupInstalled" is
        // a group nobody can read, and that is what the picker used to put there.
        expect(groups).toEqual(["[font.groupInstalled]", "[font.groupCatalog]"]);
    });

    test("answers with an installed font, carrying its bytes", async () => {
        stubInstalledFonts([installedEntry("PingFang SC", "Regular")]);
        answer = (content, buttons) => {
            (content.querySelector("select") as HTMLSelectElement).value = "PingFang SC-Regular";
            buttons[0].onclick?.();
        };

        const picked = await openPicker();

        expect(picked.isOk).toBe(true);
        expect(picked.value.name).toBe("PingFang SC Regular");
        // The bytes travel with it: a font off a disk has no address to fetch later.
        const base64 = (picked.value.data ?? "").split(",")[1];
        expect([...atob(base64)]).toEqual(["\u0001", "\u0002", "\u0003"]);
    });

    test("draws each font of this machine in the font it names", async () => {
        stubInstalledFonts([installedEntry("PingFang SC", "Bold Italic")]);
        let row: HTMLOptionElement | undefined;
        answer = (content, buttons) => {
            row = content.querySelector("option") as HTMLOptionElement;
            buttons[2].onclick?.();
        };
        await openPicker();

        // A name says neither what a family looks like nor which weight was meant, so the row
        // is drawn in the font — and in the weight and the slant its style names.
        // The DOM quotes a family of more than one word, which is how it comes back.
        expect(row?.style.fontFamily).toContain("PingFang SC");
        expect(row?.style.fontWeight).toBe("bold");
        expect(row?.style.fontStyle).toBe("italic");
    });

    test("narrows the list to what is typed into the filter", async () => {
        stubInstalledFonts([installedEntry("PingFang SC", "Regular"), installedEntry("Roboto", "Regular")]);
        let values: string[] = [];
        answer = (content, buttons) => {
            const filter = content.querySelector("input") as HTMLInputElement;
            filter.value = "roboto";
            filter.dispatchEvent(new Event("input"));
            values = [...content.querySelectorAll("option")].map((option) => option.value);
            buttons[2].onclick?.();
        };
        await openPicker();

        // Hundreds of fonts are what a machine carries, and the name is all there is to
        // search by — the catalogue is narrowed by the same name.
        expect(values).toContain("Roboto-Regular");
        expect(values).not.toContain("PingFang SC-Regular");
    });

    test("offers only the catalogue when the browser cannot list fonts", async () => {
        let groups: string[] = [];
        answer = (content, buttons) => {
            groups = [...content.querySelectorAll("optgroup")].map((group) => group.label);
            buttons[2].onclick?.();
        };
        await openPicker();

        expect(groups).toEqual(["font.groupCatalog"]);
    });

    test("answers with nothing when the dialog is cancelled", async () => {
        answer = (_content, buttons) => buttons[2].onclick?.();

        const picked = await openPicker();

        expect(picked.isOk).toBe(false);
        expect(picked.error).toBe("cancel");
    });

    test("goes to a file when that is what the user asked for", async () => {
        answer = (_content, buttons) => buttons[1].onclick?.();

        void openPicker();
        await settled();

        // Reading a file opens the browser's own picker, which is a file input.
        expect(document.body.querySelector("input[type=file]")).not.toBeNull();
    });
});
