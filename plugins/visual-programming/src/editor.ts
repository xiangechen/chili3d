// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, type IDocument, Localize, PubSub } from "@chili3d/core";
import { button, div, label, span, svg } from "@chili3d/element";
import { type LitArea2D, LitPlugin, Presets } from "@retejs/lit-plugin";
import { html } from "lit";
import { ClassicPreset, NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import type { Selector } from "rete-area-plugin/_types/extensions";
import { AutoArrangePlugin } from "rete-auto-arrange-plugin";
import { CommentExtensions, CommentPlugin } from "rete-comment-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { RerouteExtensions, ReroutePlugin } from "rete-connection-reroute-plugin";
import {
    type ContextMenuExtra,
    ContextMenuPlugin,
    Presets as ContextMenuPresets,
} from "rete-context-menu-plugin";
import { DataflowEngine } from "rete-engine";
import { HistoryExtensions, HistoryPlugin, Presets as HistoryPresets } from "rete-history-plugin";
import { MinimapPlugin } from "rete-minimap-plugin";
import { PanelControl } from "./controls/panel";
import { NumberSliderControl } from "./controls/slider";
import { CustomConnectionElement } from "./customs/connection";
import { CustomNodeElement } from "./customs/node";
import { CustomSocketElement } from "./customs/socket";
import style from "./editor.module.css";
import "./context-menu.module.css";
import { GeometryBaseNode } from "./nodes/geometry/base";
import { tools } from "./tools";
import type { INodeEditor, Schemes } from "./types";
import "./asserts/iconfont.js";

export type AreaExtra = LitArea2D<Schemes> | ContextMenuExtra;

customElements.define("custom-node", CustomNodeElement);
customElements.define("custom-connection", CustomConnectionElement);
customElements.define("custom-socket", CustomSocketElement);

export class Editor implements INodeEditor {
    readonly editor = new NodeEditor<Schemes>();
    readonly engine = new DataflowEngine();
    readonly socket = new ClassicPreset.Socket("socket");
    readonly tools = div({ className: style.tools }, ...this.renderTools());
    readonly view = div({ className: style.view });
    readonly previewNode = div({ className: style.previewNode });
    readonly area: AreaPlugin<Schemes, AreaExtra>;
    private pendingNodeType: (new (editor: INodeEditor) => ClassicPreset.Node) | null = null;

    constructor(readonly document: IDocument) {
        this.area = new AreaPlugin<Schemes, AreaExtra>(this.view);
    }

    async show() {
        this.view.append(this.previewNode);
        const root = div(
            {
                className: style.root,
                onkeydown: (e) => {
                    e.stopPropagation();
                    if (e.key === "Escape" && this.pendingNodeType) {
                        this.cancelPendingNode();
                    }
                },
                onkeyup: (e) => {
                    e.stopPropagation();
                },
            },
            this.tools,
            this.view,
        );
        await this.init();

        PubSub.default.pub("showFloatPanel", {
            title: "vp.editor.title" as I18nKeys,
            content: root,
            width: 1000,
            height: 600,
            onClose: () => {
                this.dispose();
            },
        });
    }

    async addNode(node: new (editor: INodeEditor) => ClassicPreset.Node, x?: number, y?: number) {
        const n = new node(this);
        await this.editor.addNode(n);
        if (x !== undefined && y !== undefined) {
            const { clientWidth, clientHeight } = this.area.nodeViews.get(n.id)!.element;
            this.area.translate(n.id, { x: x - clientWidth * 0.5, y: y - clientHeight * 0.5 });
        }
    }

    private cancelPendingNode() {
        this.pendingNodeType = null;
        this.view.classList.remove(style.waiting);
        this.previewNode.classList.remove(style.visible);
    }

    private handleViewClick = (e: MouseEvent) => {
        if (!this.pendingNodeType) return;

        const rect = this.area.container.getBoundingClientRect();
        const { x, y, k } = this.area.area.transform;
        const canvasX = (e.clientX - rect.left - x) / k;
        const canvasY = (e.clientY - rect.top - y) / k;
        this.addNode(this.pendingNodeType, canvasX, canvasY);

        this.cancelPendingNode();
    };

    private handleViewMouseMove = (e: MouseEvent) => {
        if (!this.pendingNodeType) return;

        if (!this.previewNode.classList.contains(style.visible)) {
            this.previewNode.classList.add(style.visible);
        }

        const rect = this.area.container.getBoundingClientRect();
        this.previewNode.style.left = `${e.clientX - rect.left - 30}px`;
        this.previewNode.style.top = `${e.clientY - rect.top - 10}px`;
    };

    private renderTools() {
        const groups: HTMLElement[] = [];
        for (const tool of tools) {
            groups.push(
                div(
                    { className: style.group },
                    div(
                        { className: style.groupContent },
                        ...tool.items.map((x) => {
                            return button(
                                {
                                    className: style.toolButton,
                                    onclick: () => {
                                        this.pendingNodeType = x.node;
                                        this.view.classList.add(style.waiting);
                                    },
                                },
                                svg({ className: style.icon, icon: x.icon }),
                                span({ textContent: new Localize(x.display as I18nKeys) }),
                            );
                        }),
                    ),
                    label({ textContent: new Localize(tool.groupName as I18nKeys) }),
                ),
            );
        }

        return groups;
    }

    public async init() {
        const selectorAccumulating = AreaExtensions.accumulateOnCtrl();
        const selector = AreaExtensions.selector();
        const render = new LitPlugin<Schemes, AreaExtra>();

        this.editor.use(this.area);
        this.editor.use(this.engine as any);
        this.area.use(render);
        AreaExtensions.simpleNodesOrder(this.area);
        AreaExtensions.showInputControl(this.area);
        AreaExtensions.selectableNodes(this.area, selector, {
            accumulating: selectorAccumulating,
        });

        this.editor.addPipe((context) => {
            if (["connectioncreated", "connectionremoved"].includes(context.type)) {
                this.process();
            }
            return context;
        });
        this.initCustomStyle();
        this.initArrange();
        this.initHistory();
        this.initConnection();
        this.initContextMenu(render);
        //this.initMinimap(render);
        this.initPreset(render);
        this.initCommet(selector, selectorAccumulating);
        this.initRouter(render, selector, selectorAccumulating);
        this.view.addEventListener("click", this.handleViewClick);
        this.view.addEventListener("mousemove", this.handleViewMouseMove);
    }

    readonly process = () => {
        this.engine.reset();
        this.editor.getNodes().forEach((n) => this.engine.fetch(n.id));

        this.document.visual.update();
    };

    private initCustomStyle() {
        this.area.area.content.add(
            div({
                className: style.background,
            }),
        );
    }

    private initPreset(render: LitPlugin<Schemes, AreaExtra>) {
        render.addPreset(
            Presets.classic.setup({
                customize: {
                    node(data) {
                        return ({ emit }) =>
                            html`<custom-node .data=${data.payload} .emit=${emit}></custom-node>`;
                    },
                    connection() {
                        return ({ path }) => html`<custom-connection .path=${path}></custom-connection>`;
                    },
                    socket(data) {
                        return () => html`<custom-socket .data=${data}></custom-socket>`;
                    },
                    control(data) {
                        if (data.payload instanceof NumberSliderControl) {
                            const { payload } = data;
                            return () => html`<slider-element .data=${payload}></slider-element>`;
                        }
                        if (data.payload instanceof PanelControl) {
                            const { payload } = data;
                            return () => html`<panel-element .data=${payload}></panel-element>`;
                        }
                        if (data.payload instanceof ClassicPreset.InputControl) {
                            const { payload } = data;
                            return () => html`<rete-control .data=${payload}></rete-control>`;
                        }
                        return () => null;
                    },
                },
            }),
        );
    }

    private initMinimap(render: LitPlugin<Schemes, AreaExtra>) {
        const minimap = new MinimapPlugin({
            boundViewport: true,
        });
        render.addPreset(Presets.minimap.setup({ size: 150 }) as any);
        this.area.use(minimap as any);
    }

    private initHistory() {
        const history = new HistoryPlugin<Schemes>();
        HistoryExtensions.keyboard(history);
        history.addPreset(HistoryPresets.classic.setup());
        this.area.use(history);
    }

    private initConnection() {
        const connection = new ConnectionPlugin<Schemes, AreaExtra>();
        connection.addPreset(ConnectionPresets.classic.setup());
        this.area.use(connection);
    }

    private initRouter(
        render: LitPlugin<Schemes, AreaExtra>,
        selector: Selector<any>,
        selectorAccumulating: any,
    ) {
        const reroutePlugin = new ReroutePlugin<Schemes>();
        RerouteExtensions.selectablePins(reroutePlugin, selector, selectorAccumulating);
        render.use(reroutePlugin as any);
        render.addPreset(
            Presets.reroute.setup({
                pointerdown(id: string) {
                    reroutePlugin.unselect(id);
                    reroutePlugin.select(id);
                },
                contextMenu(id: string) {
                    reroutePlugin.remove(id);
                },
                translate(id: string, dx: number, dy: number) {
                    reroutePlugin.translate(id, dx, dy);
                },
            }) as any,
        );
    }

    private initCommet(selector: Selector<any>, selectorAccumulating: any) {
        const comment = new CommentPlugin();
        this.area.use(comment as any);
        CommentExtensions.selectable(comment, selector, selectorAccumulating);
    }

    private initContextMenu(render: LitPlugin<Schemes, AreaExtra>) {
        const rootItems = ContextMenuPresets.classic.setup(
            tools
                .flatMap((x) => x.items)
                .map((x) => [
                    I18n.translate(x.display as I18nKeys),
                    () => {
                        this.addNode(x.node);
                    },
                ]) as any,
        );
        const contextMenu = new ContextMenuPlugin<Schemes>({
            items: (context, plugin) => {
                if (context === "root") {
                    return rootItems(context, plugin);
                }
                const node = context as Schemes["Node"];
                const items: any[] = [];
                if (node instanceof GeometryBaseNode) {
                    items.push({
                        label: node.visibility ? "Hide" : "Show",
                        key: "visibility",
                        handler: () => {
                            node.visibility = !node.visibility;
                        },
                    });
                }
                items.push({
                    label: "Delete",
                    key: "delete",
                    handler: () => {
                        const connections = this.editor
                            .getConnections()
                            .filter((c) => c.source === node.id || c.target === node.id);
                        for (const conn of connections) {
                            this.editor.removeConnection(conn.id);
                        }
                        this.editor.removeNode(node.id);
                    },
                });
                return { searchBar: false, list: items };
            },
        });
        render.addPreset(Presets.contextMenu.setup());
        this.area.use(contextMenu);
    }

    private initArrange() {
        const arrange = new AutoArrangePlugin();
        this.area.use(arrange as any);
    }

    dispose() {
        this.view.removeEventListener("click", this.handleViewClick);
        this.view.removeEventListener("mousemove", this.handleViewMouseMove);
        this.area.destroy();
    }
}
