// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ArcNode } from "./nodes/geometry/arc";
import { BoxNode } from "./nodes/geometry/box";
import { CircleNode } from "./nodes/geometry/circle";
import { DivideCurveNode } from "./nodes/geometry/divideCurve";
import { EdgeCurveNode } from "./nodes/geometry/edgeCurve";
import { FaceSurfaceNode } from "./nodes/geometry/faceSurface";
import { LineNode } from "./nodes/geometry/line";
import { PointNode } from "./nodes/geometry/point";
import { RectNode } from "./nodes/geometry/rect";
import { NumberNode } from "./nodes/input/number";
import { PanelNode } from "./nodes/input/panel";
import { NumberSliderNode } from "./nodes/input/slider";
import { ListConcatNode } from "./nodes/list/listConcat";
import { ListGetFirstNode } from "./nodes/list/listGetFirst";
import { ListGetItemNode } from "./nodes/list/listGetItem";
import { ListGetLastNode } from "./nodes/list/listGetLast";
import { ListLengthNode } from "./nodes/list/listLength";
import { ListReverseNode } from "./nodes/list/listReverse";
import { ListShiftNode } from "./nodes/list/listShift";
import { AddNode } from "./nodes/math/add";
import { CeilNode } from "./nodes/math/ceil";
import { CosNode } from "./nodes/math/cos";
import { CrossProductNode } from "./nodes/math/crossProduct";
import { DivisionNode } from "./nodes/math/division";
import { DotProductNode } from "./nodes/math/dotProduct";
import { FloorNode } from "./nodes/math/floor";
import { ModNode } from "./nodes/math/mod";
import { MultiplyNode } from "./nodes/math/multiply";
import { NormalizeNode } from "./nodes/math/normalize";
import { PlaneNode } from "./nodes/math/plane";
import { RoundNode } from "./nodes/math/round";
import { SinNode } from "./nodes/math/sin";
import { SubNode } from "./nodes/math/sub";
import { TanNode } from "./nodes/math/tan";
import { VectorLengthNode } from "./nodes/math/vectorLength";
import { XYZNode } from "./nodes/math/xyz";
import type { ToolGroup } from "./types";

export const tools: ToolGroup[] = [
    {
        groupName: "vp.toolbar.input",
        items: [
            {
                display: "vp.nodes.number",
                icon: "icon-shuzi",
                node: NumberNode,
            },
            {
                display: "vp.nodes.slider",
                icon: "icon-huakuai",
                node: NumberSliderNode,
            },
            {
                display: "vp.nodes.panel",
                icon: "icon-pingmian",
                node: PanelNode,
            },
        ],
    },
    {
        groupName: "vp.toolbar.math",
        items: [
            {
                display: "vp.nodes.sin",
                icon: "icon-Sin",
                node: SinNode,
            },
            {
                display: "vp.nodes.cos",
                icon: "icon-Cos",
                node: CosNode,
            },
            {
                display: "vp.nodes.tan",
                icon: "icon-Tan",
                node: TanNode,
            },
            {
                display: "vp.nodes.mod",
                icon: "icon-qiumo",
                node: ModNode,
            },
            {
                display: "vp.nodes.ceil",
                icon: "icon-ceil",
                node: CeilNode,
            },
            {
                display: "vp.nodes.floor",
                icon: "icon-floor",
                node: FloorNode,
            },
            {
                display: "vp.nodes.round",
                icon: "icon-round",
                node: RoundNode,
            },
        ],
    },
    {
        groupName: "vp.toolbar.operator",
        items: [
            {
                display: "vp.nodes.add",
                icon: "icon-jia",
                node: AddNode,
            },
            {
                display: "vp.nodes.sub",
                icon: "icon-jian",
                node: SubNode,
            },
            {
                display: "vp.nodes.multiply",
                icon: "icon-cheng",
                node: MultiplyNode,
            },
            {
                display: "vp.nodes.division",
                icon: "icon-chu",
                node: DivisionNode,
            },
        ],
    },
    {
        groupName: "vp.toolbar.vector",
        items: [
            {
                display: "vp.nodes.XYZ",
                icon: "icon-xiangliang",
                node: XYZNode,
            },
            {
                display: "vp.nodes.length",
                icon: "icon-changdu",
                node: VectorLengthNode,
            },
            {
                display: "vp.nodes.normalize",
                icon: "icon-normalize",
                node: NormalizeNode,
            },
            {
                display: "vp.nodes.cross",
                icon: "icon-cross",
                node: CrossProductNode,
            },
            {
                display: "vp.nodes.dot",
                icon: "icon-dot",
                node: DotProductNode,
            },
        ],
    },
    {
        groupName: "vp.toolbar.geometry",
        items: [
            {
                display: "vp.nodes.point",
                icon: "icon-point",
                node: PointNode,
            },
            {
                display: "vp.nodes.line",
                icon: "icon-line",
                node: LineNode,
            },
            {
                display: "vp.nodes.divideCurve",
                icon: "icon-dingshudian",
                node: DivideCurveNode,
            },
            {
                display: "vp.nodes.circle",
                icon: "icon-circle",
                node: CircleNode,
            },
            {
                display: "vp.nodes.arc",
                icon: "icon-arc",
                node: ArcNode,
            },
            {
                display: "vp.nodes.rect",
                icon: "icon-rect",
                node: RectNode,
            },
            {
                display: "vp.nodes.box",
                icon: "icon-box",
                node: BoxNode,
            },
            {
                display: "vp.nodes.plane",
                icon: "icon-pingmian",
                node: PlaneNode,
            },
            {
                display: "vp.nodes.edgeCurve",
                icon: "icon-edgeCurve",
                node: EdgeCurveNode,
            },
            {
                display: "vp.nodes.faceSurface",
                icon: "icon-faceSurface",
                node: FaceSurfaceNode,
            },
        ],
    },
    {
        groupName: "vp.toolbar.list",
        items: [
            {
                display: "vp.nodes.listGetItem",
                icon: "icon-listGetItem",
                node: ListGetItemNode,
            },
            {
                display: "vp.nodes.listLength",
                icon: "icon-listLength",
                node: ListLengthNode,
            },
            {
                display: "vp.nodes.listConcat",
                icon: "icon-listConcat",
                node: ListConcatNode,
            },
            {
                display: "vp.nodes.listGetFirst",
                icon: "icon-listGetFirst",
                node: ListGetFirstNode,
            },
            {
                display: "vp.nodes.listGetLast",
                icon: "icon-listGetLast",
                node: ListGetLastNode,
            },
            {
                display: "vp.nodes.listReverse",
                icon: "icon-listReverse",
                node: ListReverseNode,
            },
            {
                display: "vp.nodes.listShift",
                icon: "icon-listShift",
                node: ListShiftNode,
            },
        ],
    },
];
