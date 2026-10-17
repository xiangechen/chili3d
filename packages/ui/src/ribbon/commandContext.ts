// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    Binding,
    CancelableCommand,
    type Combobox,
    CommandStore,
    EMPTY_SCOPE,
    I18n,
    type I18nKeys,
    type ICancelableCommand,
    type ICommand,
    type IDisposable,
    type IDocument,
    isCancelableCommand,
    isPropertyChanged,
    isTargetProvider,
    Localize,
    Observable,
    PathBinding,
    type Property,
    PropertyUtils,
    PubSub,
    parseParameterValue,
    Result,
    resolveUnitSpec,
    type Scope,
    type UnitSpec,
} from "@chili3d/core";
import {
    button,
    ColorConverter,
    createIcon,
    div,
    input,
    label,
    option,
    select,
    span,
    svg,
    TargetList,
    UrlStringConverter,
} from "@chili3d/element";
import style from "./commandContext.module.css";

export class CommandContext extends HTMLElement implements IDisposable {
    private readonly propMap: Map<string | number | symbol, [Property, HTMLElement][]> = new Map();
    private readonly container = div({ className: style.container });
    /** The parameter groups, in their own column so a second row wraps under the first one
     *  rather than under the command icon. */
    private readonly groupsContainer = div({ className: style.groups });
    private selectionControlContainer?: HTMLDivElement;
    private closeIcon?: HTMLElement;
    private selectionCountCleanups: Array<() => void> = [];
    private resizeObserver?: ResizeObserver;
    private fitPending = false;

    constructor(readonly command: ICommand) {
        super();
        this.className = style.panel;
        this.append(this.container);
        this.render();
    }

    private render() {
        const data = CommandStore.getComandData(this.command);
        const icon = createIcon(data!.icon);
        icon.classList.add(style.icon);
        this.container.append(
            div(
                { className: style.command },
                icon,
                label({ className: style.title, textContent: new Localize(`command.${data!.key}`) }),
            ),
            this.groupsContainer,
        );
        this.initContext();
        if (isCancelableCommand(this.command)) {
            this.closeIcon = div(
                { className: style.cancelButton },
                div(
                    {
                        className: style.selectionButton,
                        onclick: () => (this.command as CancelableCommand).cancel(),
                    },
                    svg({ icon: "icon-cancel" }),
                ),
            );
            this.container.append(this.closeIcon);
        }
    }

    /**
     * The bare confirm/cancel bar. A step that edits a value by dragging is not a
     * selection, so the picked-shape count would be a number the user cannot act on —
     * and it reads as "0 selected" whenever nothing happens to be selected.
     */
    private readonly showConfirmControl = (controller: AsyncController) => {
        this.showControl(controller, false);
    };

    private readonly showSelectionControl = (controller: AsyncController) => {
        this.showControl(controller, true);
    };

    private showControl(controller: AsyncController, showCount: boolean) {
        if (this.selectionControlContainer) return;
        if (this.closeIcon) this.closeIcon.style.display = "none";

        this.selectionControlContainer = div(
            { className: style.selectionControl },
            ...(showCount ? [this.selectionInfoDom()] : []),
            div(
                { className: style.selectionButton, onclick: () => controller.success() },
                svg({ icon: "icon-confirm" }),
            ),
            div(
                { className: style.selectionButton, onclick: () => controller.cancel() },
                svg({ icon: "icon-cancel" }),
            ),
        );
        this.container.append(this.selectionControlContainer);
        this.scheduleFit();
    }

    private selectionInfoDom() {
        return div(
            { className: style.selectionInfo },
            this.countDom(),
            span({
                className: style.selectionCountLabel,
                textContent: new Localize("prompt.selectedCount"),
            }),
        );
    }

    private countDom() {
        const countSpan = span({ className: style.selectionCount, textContent: "0" });
        if (this.command instanceof CancelableCommand) {
            const sel = this.command.document.selection;
            const updateCount = () => {
                const count = sel.getSelectedShapes().length || sel.getSelectedNodeLength();
                countSpan.textContent = String(count);
            };
            updateCount();
            sel.onShapeChanged.sub(updateCount);
            sel.onNodeChanged.sub(updateCount);
            this.selectionCountCleanups.push(() => {
                sel.onShapeChanged.remove(updateCount);
                sel.onNodeChanged.remove(updateCount);
            });
        }
        return countSpan;
    }

    private readonly clearSelectionControl = () => {
        this.selectionControlContainer?.remove();
        this.selectionControlContainer = undefined;
        if (this.closeIcon) this.closeIcon.style.display = "";
        this.selectionCountCleanups.forEach((fn) => fn());
        this.selectionCountCleanups = [];
        this.scheduleFit();
    };

    /** The one bar, however it was opened. */
    private readonly clearConfirmControl = () => this.clearSelectionControl();

    connectedCallback(): void {
        PubSub.default.sub("showConfirmControl", this.showConfirmControl);
        PubSub.default.sub("clearConfirmControl", this.clearConfirmControl);
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
        if (this.command instanceof Observable) {
            this.command.onPropertyChanged(this.onPropertyChanged);
        }
        this.observeWidth();
    }

    disconnectedCallback(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.clearSelectionControl();
        PubSub.default.remove("showConfirmControl", this.showConfirmControl);
        PubSub.default.remove("clearConfirmControl", this.clearConfirmControl);
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        if (this.command instanceof Observable) {
            this.command.removePropertyChanged(this.onPropertyChanged);
        }
    }

    dispose() {
        this.propMap.clear();
        this.disconnectedCallback();
    }

    private observeWidth() {
        if (typeof ResizeObserver === "undefined" || !this.parentElement) return;
        this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
        this.resizeObserver.observe(this.parentElement);
        this.scheduleFit();
    }

    private scheduleFit() {
        if (this.fitPending) return;
        this.fitPending = true;
        const run = () => {
            this.fitPending = false;
            this.fitWidth();
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
        else run();
    }

    /**
     * The panel's width sits between what the parameters need and the 90% ceiling — half of
     * the room the viewport leaves. That way a narrow viewport keeps the panel compact, and
     * a wide one widens the controls instead of parking the extra room after the last
     * column.
     */
    private fitWidth() {
        if (!this.isConnected || !this.parentElement) return;
        this.style.width = "";
        this.measureColumnWidth();
        // The grid's natural width depends on the column count it was last given, so the
        // panel would shrink to that count's width and then measure the available width
        // against itself — one column forever. Lay every parameter on one row first.
        this.groupsContainer.style.setProperty("--columns", `${Math.max(this.visibleItems().length, 1)}`);
        const columns = this.balanceColumns();
        const content = this.contentWidth(columns);
        const ceiling = this.parentElement.getBoundingClientRect().width * 0.9;
        // Only a command with a real grid of parameters spends the extra room: one (or no)
        // parameter would just become a long empty bar.
        const grow = columns > 1 ? (ceiling - content) / 2 : 0;
        this.style.width = `${Math.ceil(content + Math.max(0, grow))}px`;
    }

    /**
     * The column pitch is the width of this command's widest pair, not a fixed 170px: a
     * command with three short options would otherwise leave a blank cell under each of
     * them. Letting go of the minimum first is what makes the pairs report their natural
     * widths.
     */
    private measureColumnWidth() {
        const items = this.visibleItems();
        if (items.length === 0) return;
        this.groupsContainer.setAttribute("data-measuring", "");
        this.groupsContainer.style.setProperty("--column-width", "0px");
        const widest = Math.max(...items.map((item) => item.getBoundingClientRect().width));
        this.groupsContainer.removeAttribute("data-measuring");
        // A hidden panel reports every box as 0 — keep the fallback rather than pinning
        // the columns to nothing and letting each pair size itself. The 150 floor is the
        // smallest pitch that still holds a 4.5em label, a 64px control and the padding;
        // below it a control would spill out of its tile and into the next one.
        const width = widest > 0 ? Math.max(Math.ceil(widest), 150) : 170;
        this.groupsContainer.style.setProperty("--column-width", `${width}px`);
    }

    /**
     * The widest column count the panel can hold is not always the best one: four options
     * at three columns become 3 + 1, while two columns give 2 + 2. Pick the count with the
     * fewest rows and, among equals, the fullest last row.
     */
    private balanceColumns(): number {
        const count = this.visibleItems().length;
        const group = this.groupsContainer.firstElementChild as HTMLElement | null;
        if (count === 0 || !group) {
            this.groupsContainer.style.removeProperty("--columns");
            return 1;
        }
        const column =
            Number.parseFloat(this.groupsContainer.style.getPropertyValue("--column-width")) || 170;
        const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
        const available = this.groupsContainer.getBoundingClientRect().width;
        const maxColumns = Math.max(1, Math.floor((available + gap) / (column + gap)));
        let best = 1;
        let bestRows = count + 1;
        let bestLast = 0;
        for (let columns = 1; columns <= maxColumns; columns++) {
            const rows = Math.ceil(count / columns);
            const last = count % columns === 0 ? columns : count % columns;
            if (rows < bestRows || (rows === bestRows && last > bestLast)) {
                best = columns;
                bestRows = rows;
                bestLast = last;
            }
        }
        this.groupsContainer.style.setProperty("--columns", `${best}`);
        return best;
    }

    private visibleItems(): HTMLElement[] {
        const items: HTMLElement[] = [];
        for (const group of this.groupsContainer.children) {
            for (const item of group.children) {
                if ((item as HTMLElement).style.display !== "none") items.push(item as HTMLElement);
            }
        }
        return items;
    }

    /** The narrowest the panel can be with `columns` columns of the measured pitch. */
    private contentWidth(columns: number) {
        const column =
            Number.parseFloat(this.groupsContainer.style.getPropertyValue("--column-width")) || 170;
        const group = this.groupsContainer.firstElementChild as HTMLElement | null;
        const columnGap = group ? Number.parseFloat(getComputedStyle(group).columnGap) || 0 : 0;
        const groups = this.hasVisibleParameters() ? columns * column + (columns - 1) * columnGap : 0;
        const style = getComputedStyle(this.container);
        const gap = Number.parseFloat(style.columnGap) || 0;
        const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(style.paddingRight) || 0;
        const badge = this.container.firstElementChild as HTMLElement | null;
        const badgeWidth = badge?.getBoundingClientRect().width ?? 0;
        const controls = this.selectionControlContainer ?? this.closeIcon;
        const controlsWidth = controls?.getBoundingClientRect().width ?? 0;
        // An empty parameter group still sits between the badge and the buttons and still
        // carries both gaps, so a command that only picks objects needs one more of them.
        const gaps = this.hasVisibleParameters() ? 1 : 2;
        return groups + badgeWidth + controlsWidth + gap * gaps + paddingLeft + paddingRight + 2;
    }

    private hasVisibleParameters() {
        return this.visibleItems().length > 0;
    }

    private readonly onPropertyChanged = (property: string | number | symbol) => {
        if (this.propMap.has(property)) {
            const items = this.propMap.get(property)!;
            for (const [prop, control] of items) {
                this.setVisible(control, prop);
            }
        }
        this.scheduleFit();
    };

    private initContext() {
        const groupMap = new Map<I18nKeys, HTMLDivElement>();
        const isCancelable = isCancelableCommand(this.command);
        const cancleProp: keyof ICancelableCommand = "cancel";

        PropertyUtils.getProperties(this.command).forEach((property) => {
            if (isCancelable && property.name === cancleProp) return;

            const group = this.findGroup(groupMap, property);
            const item = this.createItem(this.command, property);
            this.setVisible(item, property);
            this.cacheDependencies(item, property);
            group.append(item);
        });
    }

    private cacheDependencies(item: HTMLElement, g: Property) {
        if (g.dependencies) {
            for (const d of g.dependencies) {
                const items = this.propMap.get(d.property);
                this.propMap.set(d.property, [...(items ?? []), [g, item]]);
            }
        }
    }

    private setVisible(control: HTMLElement, property: Property) {
        let visible = !PropertyUtils.isHiddenProperty(this.command, property.name);
        if (visible && property.dependencies) {
            for (const d of property.dependencies) {
                if ((this.command as any)[d.property] !== d.value) {
                    visible = false;
                    break;
                }
            }
        }
        // Back to the stylesheet's own display, not `inherit`: the group is a grid container
        // now, and inheriting that would turn the tile into a grid too.
        control.style.display = visible ? "" : "none";
    }

    private findGroup(groupMap: Map<I18nKeys, HTMLDivElement>, prop: Property) {
        let group = groupMap.get(prop.group!);
        if (group === undefined) {
            group = div({ className: style.group });
            groupMap.set(prop.group!, group);
            this.groupsContainer.append(group);
        }
        return group;
    }

    private createItem(command: ICommand, g: Property) {
        const noType = command as any;
        const type = typeof noType[g.name];

        if (g.type === "materialId") {
            return this.materialEditor(g, noType);
        } else if (g.type === "font") {
            return this.fontEditor(g, noType);
        } else if (g.type === "targets") {
            return this.newTargets(g, command, noType);
        } else if (g.combobox) {
            return this.newCombobox(g, g.combobox);
        }

        if (g.unit !== undefined) {
            return this.newExpressionInput(g, noType, g.unit);
        }

        switch (type) {
            case "function":
                return this.newButton(g, noType);
            case "boolean":
                return this.newCheckbox(g, noType);
            case "number":
                return this.newInput(g, noType, parseFloat);
            case "string":
                return this.newInput(g, noType);
            default:
                throw new Error("暂不支持的类型");
        }
    }

    /**
     * The bodies a join/cut/intersect feature combines with. Unlike every other control here,
     * this one is not a snapshot: the command fills the set from its own detection once the
     * picks have given it a tool to measure, which is after this panel was built. So the
     * control subscribes to the command's own property and redraws itself — the alternative
     * (rebuilding the whole context) would throw away the live picking with it.
     */
    private newTargets(g: Property, command: ICommand, noType: any) {
        if (!isTargetProvider(command)) {
            throw new Error("A targets property needs a command that provides its targets");
        }

        return new TargetList(g.display, {
            candidates: () => command.targetCandidates(),
            selected: () => noType[g.name],
            setSelection: (value) => command.setTargets(value),
            subscribe: (handler) => {
                if (!isPropertyChanged(command)) return () => {};
                const onChanged = (property: string | number | symbol) => {
                    if (property === g.name) handler();
                };
                command.onPropertyChanged(onChanged);
                return () => command.removePropertyChanged(onChanged);
            },
        });
    }

    private newCombobox(g: Property, combobox: Combobox<any>) {
        // The command property is the source of truth (CancelableCommand restores it from the
        // properties cache), while the combobox is shared across command instances — derive the
        // selection from the property value instead of the shared combobox.selectedIndex.
        const valueIndex = combobox.items.indexOf((this.command as any)[g.name]);
        const selectedIndex = valueIndex < 0 ? combobox.selectedIndex : valueIndex;
        const options = combobox.items.map((item, index) => {
            return option({
                selected: index === selectedIndex,
                textContent: I18n.isI18nKey(item)
                    ? new Localize(item)
                    : (combobox.converter?.convert(item).unchecked() ?? String(item)),
            });
        });

        return div(
            label({ textContent: new Localize(g.display) }),
            select(
                {
                    className: style.select,
                    onchange: (e) => {
                        combobox.selectedIndex = (e.target as HTMLSelectElement).selectedIndex;
                        (this.command as any)[g.name] = combobox.selectedItem;
                    },
                },
                ...options,
            ),
        );
    }

    /**
     * A dimensional field that also takes an expression (`w * 2`). The text is stored as
     * written — a feature keeps the RELATION, not the number it happened to evaluate to,
     * which is what lets a later parameter edit carry through. The document's parameters
     * decide whether the text resolves at all; a value that will not resolve is refused
     * with a toast rather than written, because writing it would silently break the rebuild.
     */
    private newExpressionInput(g: Property, noType: any, expected: UnitSpec) {
        return div(
            label({ textContent: new Localize(g.display) }),
            input({
                type: "text",
                className: style.input,
                value: new Binding(noType, g.name),
                onblur: (e) => {
                    const box = e.target as HTMLInputElement;
                    const text = box.value;
                    if (text === "") return;
                    const value = parseParameterValue(text);
                    if (typeof value === "string") {
                        const resolved = resolveUnitSpec(value, this.parameterScope(), expected);
                        if (!resolved.isOk) {
                            PubSub.default.pub("showToast", "error.default:{0}", resolved.error);
                            // The command refused the text, so the field must stop showing it:
                            // the property still holds the old value, and a binding only
                            // re-renders on a property-changed emit that never came.
                            box.value = String(noType[g.name] ?? "");
                            return;
                        }
                    }
                    noType[g.name] = value;
                },
                onkeydown: (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                },
            }),
        );
    }

    /**
     * The document's parameters, for judging an expression typed into a command field.
     * `document` is not on `ICommand` — `CancelableCommand` carries it, other
     * implementations do not, and those simply have nothing to resolve against.
     */
    private parameterScope(): Scope {
        const document = (this.command as { document?: IDocument }).document;
        return document?.variables.evaluate().scope ?? EMPTY_SCOPE;
    }

    private newInput(g: Property, noType: any, converter?: (v: string) => any) {
        return div(
            label({ textContent: new Localize(g.display) }),
            input({
                type: "text",
                className: style.input,
                value: new Binding(noType, g.name),
                onblur: (e) => {
                    const input = e.target as HTMLInputElement;
                    noType[g.name] = converter ? converter(input.value) : input.value;
                },
                onkeydown: (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        const input = e.target as HTMLInputElement;
                        input.blur();
                    }
                },
            }),
        );
    }

    private newCheckbox(g: Property, noType: any) {
        return div(
            label({ textContent: new Localize(g.display) }),
            input({
                type: "checkbox",
                checked: new Binding(noType, g.name),
                onclick: () => {
                    noType[g.name] = !noType[g.name];
                },
            }),
        );
    }

    private newButton(g: Property, noType: any) {
        return button({
            className: style.button,
            textContent: new Localize(g.display),
            onclick: () => noType[g.name](),
        });
    }

    /**
     * The font row: a button that names the font in use and reopens the picker.
     * Reading a font and laying text out again is the command's job, not the
     * panel's, so the button only asks the command to do it.
     *
     * The name is bound rather than written once: picking a font sets the command's own
     * property, which the button then follows — a panel built before the choice was made
     * would go on naming the font it was built with. Nothing is named before there is a
     * font, so the label stands in until there is.
     */
    private fontEditor(g: Property, noType: any) {
        const name = () =>
            new PathBinding(noType, g.name, {
                convert: (value: string) => Result.ok(value || (I18n.translate(g.display) ?? "")),
            });

        return button({
            className: style.materialButton,
            textContent: name(),
            // The strip cuts a long name short, so the whole of it stays on the button.
            title: name(),
            onclick: () => void noType.chooseFont?.(),
        });
    }

    private materialEditor(g: Property, noType: any) {
        if (!(this.command instanceof CancelableCommand)) {
            throw new Error("MaterialEditor only support CancelableCommand");
        }

        const document = this.command.document;
        const material =
            document.modelManager.materials.find((x) => x.id === noType[g.name])! ??
            document.modelManager.materials.at(0);
        if (!material) {
            throw new Error("No material");
        }
        const display = material.clone();

        return button({
            className: style.materialButton,
            style: {
                backgroundColor: new Binding(display, "color", new ColorConverter()),
                backgroundImage: new PathBinding(display, "map.image", new UrlStringConverter()),
                backgroundBlendMode: "multiply",
                backgroundSize: "cover",
                cursor: "pointer",
            },
            textContent: new Localize(g.display),
            onclick: () => {
                PubSub.default.pub("editMaterial", document, material, (newMaterial) => {
                    noType[g.name] = newMaterial.id;
                    display.color = newMaterial.color;
                    display.map = newMaterial.map;
                });
            },
        });
    }
}

customElements.define("command-context", CommandContext);
