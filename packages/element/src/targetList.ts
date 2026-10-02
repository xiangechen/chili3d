// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, type TargetCandidate, type TargetSelection } from "@chili3d/core";
import { button, div, input, label, span } from "./elements";
import style from "./targetList.module.css";

/**
 * What a target list reads and writes. A narrow interface rather than the command itself, so
 * this control needs to know nothing about bodies, the document, or which feature is being
 * built — a command supplies it by implementing `ITargetProvider`.
 */
export interface TargetListSource {
    candidates(): readonly TargetCandidate[];
    selected(): TargetSelection;
    setSelection(value: TargetSelection): void;
    /** Calls `handler` when the selection may have changed; returns the way to stop. */
    subscribe(handler: () => void): () => void;
}

/**
 * The bodies a join/cut/intersect feature can combine with. The command panel is one row high
 * and floats over the viewport, so a list cannot live in it: the panel keeps a count, and the
 * checkboxes open under it — in the document body, since the panel clips and transforms
 * everything inside it.
 *
 * The command owns the selection, not this control. The set is filled by the command's own
 * detection as the tool takes shape, which happens after this control was rendered, so the
 * control re-renders whenever its property says the selection changed — the open list
 * included. What is checked is what will be combined; the first toggle makes the set the
 * user's, and the detection stops speaking for it.
 */
export class TargetList extends HTMLElement {
    private unsubscribe: (() => void) | undefined;
    private popup: HTMLElement | undefined;
    private readonly summary: HTMLElement;

    constructor(
        readonly header: I18nKeys,
        readonly source: TargetListSource,
    ) {
        super();
        this.summary = button({ className: style.summary, onclick: () => this.toggle() });
        this.appendChild(this.summary);
        this.refresh();
    }

    /** Redraws the count, and the open list with it — the detection moves both behind them. */
    private refresh(): void {
        this.summary.textContent = `${I18n.translate(this.header)} (${this.source.selected().ids.length})`;
        this.summary.setAttribute("aria-expanded", `${this.popup !== undefined}`);
        this.popup?.replaceChildren(...this.rows());
    }

    private rows(): HTMLElement[] {
        const candidates = this.source.candidates();
        if (candidates.length === 0) {
            return [
                div({ className: style.empty, textContent: I18n.translate("option.command.targets.empty") }),
            ];
        }
        return candidates.map((candidate) => this.row(candidate));
    }

    private row(candidate: TargetCandidate) {
        return label(
            { className: style.item, title: candidate.label },
            input({ type: "checkbox", value: candidate.id, checked: this.isChecked(candidate) }),
            span({ textContent: candidate.label }),
        );
    }

    private isChecked(candidate: TargetCandidate): boolean {
        return this.source.selected().ids.includes(candidate.id);
    }

    private toggle(): void {
        if (this.popup === undefined) this.open();
        else this.close();
    }

    private open(): void {
        this.popup = div({ className: style.popup, onchange: this.onChange }, ...this.rows());
        document.body.appendChild(this.popup);
        this.place();

        window.addEventListener("pointerdown", this.onPointerDown, true);
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("resize", this.onResize);
        this.refresh();
    }

    private close(): void {
        window.removeEventListener("pointerdown", this.onPointerDown, true);
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("resize", this.onResize);

        this.popup?.remove();
        this.popup = undefined;
        this.refresh();
    }

    /** Under the button, where the panel put it — the popup is not the panel's child. */
    private place(): void {
        if (this.popup === undefined) return;

        const rect = this.summary.getBoundingClientRect();
        this.popup.style.left = `${rect.left}px`;
        this.popup.style.top = `${rect.bottom + 4}px`;
    }

    private readonly onResize = () => this.place();

    /** The popup hangs off the body, so a click on it still counts as outside this element. */
    private readonly onPointerDown = (e: Event) => {
        const target = e.target as Node;
        if (this.popup?.contains(target) || this.contains(target)) return;
        this.close();
    };

    private readonly onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.close();
    };

    /**
     * Every box is read, not just the one that moved: a toggle is the whole set as the user
     * now means it, and writing all of it is what makes the set theirs.
     */
    private readonly onChange = () => {
        const boxes = [...(this.popup?.querySelectorAll("input") ?? [])];
        this.source.setSelection({
            auto: false,
            ids: boxes.filter((box) => box.checked).map((box) => box.value),
        });
    };

    connectedCallback(): void {
        this.unsubscribe = this.source.subscribe(() => this.refresh());
    }

    disconnectedCallback(): void {
        // The popup is not this element's child, so nothing else would take it down.
        this.close();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}

customElements.define("chili-target-list", TargetList);
