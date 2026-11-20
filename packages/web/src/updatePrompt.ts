// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n } from "@chili3d/core";
import { button, div, span, svg } from "@chili3d/element";
import style from "./updatePrompt.module.css";

export class UpdatePrompt extends HTMLElement {
    constructor(registration: ServiceWorkerRegistration) {
        super();
        this.id = "pwa-update";
        this.className = style.prompt;
        this.setAttribute("role", "status");
        this.append(this.createIcon(), this.createMessage(), this.createActions(registration));
    }

    private createIcon() {
        const icon = svg({ icon: "icon-sync-alt", className: style.icon });
        icon.setAttribute("aria-hidden", "true");
        return icon;
    }

    private createMessage() {
        const message = span({ className: style.message });
        I18n.set(message, "textContent", "pwa.updateAvailable");
        return message;
    }

    private createActions(registration: ServiceWorkerRegistration) {
        const reload = button({
            id: "pwa-update-reload",
            className: `${style.button} ${style.primary}`,
        });
        I18n.set(reload, "textContent", "pwa.reload");
        reload.addEventListener("click", () => this.requestReload(registration));
        const later = button({ className: style.button });
        I18n.set(later, "textContent", "pwa.later");
        later.addEventListener("click", () => this.remove());
        return div({ className: style.actions }, reload, later);
    }

    private requestReload(registration: ServiceWorkerRegistration) {
        if (!registration.waiting) {
            this.remove();
            window.location.reload();
            return;
        }
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
}

// This module is also a published subpath (`@chili3d/web/pwa`), so a page that pulls in
// both entries evaluates it twice; the second define would throw and take the boot down.
if (!customElements.get("chili-pwa-update")) {
    customElements.define("chili-pwa-update", UpdatePrompt);
}
