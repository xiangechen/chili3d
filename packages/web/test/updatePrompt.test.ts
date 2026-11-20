// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n } from "@chili3d/core";
import { UpdatePrompt } from "../src/updatePrompt";

describe("UpdatePrompt", () => {
    afterEach(() => {
        rs.restoreAllMocks();
        document.getElementById("pwa-update")?.remove();
    });

    function create(waiting: { postMessage: (message: unknown) => void } | null) {
        const prompt = new UpdatePrompt({ waiting } as unknown as ServiceWorkerRegistration);
        document.body.append(prompt);
        return prompt;
    }

    function findLater(prompt: UpdatePrompt) {
        const later =
            [...prompt.querySelectorAll("button")].find(
                (item) => item.textContent === I18n.translate("pwa.later"),
            ) ?? null;
        expect(later).not.toBeNull();
        return later as HTMLButtonElement;
    }

    test("should render the update message and a reload action", () => {
        const prompt = create(null);

        expect(prompt.getAttribute("role")).toBe("status");
        const message = prompt.querySelector("span");
        expect(message).not.toBeNull();
        expect(message?.textContent).toBe(I18n.translate("pwa.updateAvailable"));
        expect(prompt.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    });

    test("should ask the waiting worker to skip waiting", () => {
        const postMessage = rs.fn((_message: unknown) => {});
        create({ postMessage });

        (document.getElementById("pwa-update-reload") as HTMLButtonElement).click();

        expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });

    test("should dismiss itself when later is clicked", () => {
        const prompt = create(null);

        findLater(prompt).click();

        expect(document.getElementById("pwa-update")).toBeNull();
    });

    test("should reload the page when no worker is waiting", () => {
        const reload = rs.spyOn(window.location, "reload").mockImplementation(() => {});
        const prompt = create(null);

        (document.getElementById("pwa-update-reload") as HTMLButtonElement).click();

        expect(prompt.isConnected).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
