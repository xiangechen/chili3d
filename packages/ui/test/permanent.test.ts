// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, PubSub } from "@chili3d/core";
import { afterEach, describe, expect, test } from "@rstest/core";
import { Permanent } from "../src/permanent";

function dialogs(): NodeListOf<HTMLDialogElement> {
    return document.querySelectorAll("dialog");
}

describe("Permanent", () => {
    afterEach(() => {
        document.querySelectorAll("dialog").forEach((dialog) => {
            dialog.remove();
        });
    });

    test("shows the spinner message while the action is running", async () => {
        let release!: () => void;
        const running = Permanent.show(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
            "toast.excuting{0}",
            "Save Document",
        );

        expect(dialogs().length).toBe(1);
        // The message and its arguments reach the user, translated.
        expect(dialogs()[0].textContent).toBe(I18n.translate("toast.excuting{0}", "Save Document"));

        release();
        await running;
    });

    test("removes the spinner once the action finishes", async () => {
        await Permanent.show(async () => {}, "toast.excuting{0}", "Save Document");

        expect(dialogs().length).toBe(0);
    });

    test("puts the focus back where it was (e.g. a text box the user saved from)", async () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        expect(document.activeElement).toBe(input);

        try {
            await Permanent.show(async () => {}, "toast.excuting{0}", "Save Document");

            expect(document.activeElement).toBe(input);
        } finally {
            input.remove();
        }
    });

    test("leaves the focus alone when the action opens a dialog of its own", async () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();

        const ownDialog = document.createElement("dialog");
        const ownInput = document.createElement("input");
        ownDialog.appendChild(ownInput);
        document.body.appendChild(ownDialog);

        try {
            await Permanent.show(
                async () => {
                    ownDialog.showModal();
                    ownInput.focus();
                },
                "toast.excuting{0}",
                "Save Document",
            );

            expect(document.activeElement).toBe(ownInput);
        } finally {
            ownDialog.remove();
            input.remove();
        }
    });

    test("reports a rejected action instead of failing silently", async () => {
        const errors: string[] = [];
        const listener = (message: string) => errors.push(message);
        PubSub.default.sub("displayError", listener);

        try {
            await Permanent.show(
                async () => {
                    throw new Error("quota exceeded");
                },
                "toast.excuting{0}",
                "Save Document",
            );

            expect(errors).toEqual(["quota exceeded"]);
            expect(dialogs().length).toBe(0);
        } finally {
            PubSub.default.remove("displayError", listener);
        }
    });

    test("reports an action that throws synchronously", async () => {
        const errors: string[] = [];
        const listener = (message: string) => errors.push(message);
        PubSub.default.sub("displayError", listener);

        try {
            await Permanent.show(
                (() => {
                    throw new Error("serialize failed");
                }) as () => Promise<void>,
                "toast.excuting{0}",
                "Save Document",
            );

            expect(errors).toEqual(["serialize failed"]);
            expect(dialogs().length).toBe(0);
        } finally {
            PubSub.default.remove("displayError", listener);
        }
    });
});
