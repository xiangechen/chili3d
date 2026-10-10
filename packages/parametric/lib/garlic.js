/* @ts-self-types="./garlic.d.ts" */

/**
 * 内建约束枚举（docs/05「ConstraintKind 枚举与 params 布局」；params 布局严格等于各约束 `params()` 的顺序，
 * 带 datum 的约束 datum ParamId 占末位）。新增内建约束须同步加入本枚举、`layout` 与 `from_u32`。
 *
 * C ABI 判别值由 `from_u32` 固定（当前 0..=54），与枚举声明顺序解耦——
 * 调整顺序不会破坏已发布的 FFI 数值契约。曲线族在 2026-10 由控制点 B 样条
 * 改为 Bézier + NURBS：33/34 与 39/40/43/45/46 这 7 个原样条槽位**改义**为
 * 参数形状相同的 Bézier 对应项（0.1.0 尚未发布），NURBS 相关 kind 追加在
 * 47..=54，判别值无空洞。
 * @enum {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52 | 53 | 54}
 */
export const ConstraintKind = Object.freeze({
    /**
     * p1.x, p1.y, p2.x, p2.y
     */
    P2PCoincident: 0, "0": "P2PCoincident",
    /**
     * p1.x, p1.y, p2.x, p2.y, distance（datum 末位）
     */
    P2PDistance: 1, "1": "P2PDistance",
    /**
     * a, b
     */
    Equal: 2, "2": "Equal",
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y
     */
    PointOnLine: 3, "3": "PointOnLine",
    /**
     * p1.x, p1.y, p2.x, p2.y（残差只用 y，x 两列是 Jacobian 结构零，但 params 仍需传齐 4 个）
     */
    Horizontal: 4, "4": "Horizontal",
    /**
     * 同 Horizontal
     */
    Vertical: 5, "5": "Vertical",
    /**
     * l1.p1, l1.p2, l2.p1, l2.p2 各 (x, y)
     */
    Parallel: 6, "6": "Parallel",
    /**
     * 同 Parallel
     */
    Perpendicular: 7, "7": "Perpendicular",
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y, datum（末位）
     */
    P2LDistance: 8, "8": "P2LDistance",
    /**
     * l1.p1, l1.p2, l2.p1, l2.p2 各 (x, y), datum（弧度，末位）
     */
    Angle: 9, "9": "Angle",
    /**
     * rad, datum（末位）
     */
    Radius: 10, "10": "Radius",
    /**
     * l1 与 l2 的端点各 (x, y)
     */
    EqualLength: 11, "11": "EqualLength",
    /**
     * r1, r2
     */
    EqualRadius: 12, "12": "EqualRadius",
    /**
     * p.x, p.y, c.x, c.y, rad
     */
    PointOnCircle: 13, "13": "PointOnCircle",
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y
     */
    Midpoint: 14, "14": "Midpoint",
    /**
     * p1.x, p1.y, p2.x, p2.y, l1.x, l1.y, l2.x, l2.y
     */
    Symmetric: 15, "15": "Symmetric",
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, rad（branch 语义见 wasm/FFI 的 add_constraint）
     */
    TangentLineCircle: 16, "16": "TangentLineCircle",
    /**
     * c1.x, c1.y, r1, c2.x, c2.y, r2（branch 语义见 wasm/FFI 的 add_constraint）
     */
    TangentCircleCircle: 17, "17": "TangentCircleCircle",
    /**
     * p1.x, p1.y, p2.x, p2.y, datum（有向水平距离，末位）
     */
    HorizontalDistance: 18, "18": "HorizontalDistance",
    /**
     * 同 HorizontalDistance（有向竖直距离）
     */
    VerticalDistance: 19, "19": "VerticalDistance",
    /**
     * p1.x, p1.y, p2.x, p2.y（同高度）
     */
    HorizontalAlign: 20, "20": "HorizontalAlign",
    /**
     * p1.x, p1.y, p2.x, p2.y（同横坐标）
     */
    VerticalAlign: 21, "21": "VerticalAlign",
    /**
     * p.x, p.y, X0, Y0（2 个 datum ParamId 占末两位，无 Some(v) 语法糖）
     */
    Fix: 22, "22": "Fix",
    /**
     * p.x, p.y, c.x, c.y, s.x, s.y（s 为弧起点/半径参考点，r = ‖s−c‖）
     */
    PointOnArc: 23, "23": "PointOnArc",
    /**
     * c1.x, c1.y, s1.x, s1.y, c2.x, c2.y, s2.x, s2.y
     */
    EqualArcRadius: 24, "24": "EqualArcRadius",
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, s.x, s.y（branch 语义同 TangentLineCircle）
     */
    TangentLineArc: 25, "25": "TangentLineArc",
    /**
     * c1.x, c1.y, s1.x, s1.y, c2.x, c2.y, s2.x, s2.y（branch 语义同 TangentCircleCircle）
     */
    TangentArcArc: 26, "26": "TangentArcArc",
    /**
     * c.x, c.y, rad, a.c.x, a.c.y, a.s.x, a.s.y（branch 语义同 TangentCircleCircle；
     * 内切且弧为外时内核自动置 flip，无需导出层指定）
     */
    TangentCircleArc: 27, "27": "TangentCircleArc",
    /**
     * p.x, p.y, c.x, c.y, m.x, m.y, n.x, n.y（三点式椭圆：中心/长轴点/短轴点）
     */
    PointOnEllipse: 28, "28": "PointOnEllipse",
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, m.x, m.y, n.x, n.y（branch 语义同 TangentLineCircle）
     */
    TangentLineEllipse: 29, "29": "TangentLineEllipse",
    /**
     * rho, datum（末位，无量纲）
     */
    ConicRho: 30, "30": "ConicRho",
    /**
     * p.x, p.y, s.x, s.y, c.x, c.y, e.x, e.y, rho, t（t 为辅助曲线参数，末位；
     * 调用方创建并给初值，如投影值）
     */
    PointOnConic: 31, "31": "PointOnConic",
    /**
     * l1.x, l1.y, l2.x, l2.y, s.x, s.y, c.x, c.y, e.x, e.y, rho, t（t 末位；
     * 接触点式无 branch）
     */
    TangentLineConic: 32, "32": "TangentLineConic",
    /**
     * p.x, p.y, cp0.x, cp0.y, cp1.x, cp1.y, cp2.x, cp2.y, cp3.x, cp3.y, t
     * （定长 11：固定三次 Bézier 恒 4 个控制点，t 为辅助曲线参数，末位）
     */
    PointOnBezier: 33, "33": "PointOnBezier",
    /**
     * l1.x, l1.y, l2.x, l2.y, cp0.x, cp0.y, …, cp3.x, cp3.y, t（定长 13，t 末位）
     */
    TangentLineBezier: 34, "34": "TangentLineBezier",
    /**
     * p.x, p.y, cp0.x, cp0.y, …, cp_{n−1}.x, cp_{n−1}.y, w0, …, w_{n−1}, t
     * （变长 3n+3：n 个控制点 + n 个有理权重 + 辅助曲线参数 t 末位；次数与
     * 节点矢量经 `nurbs` 入参给出，n 由节点矢量长度反推）
     */
    PointOnNurbs: 35, "35": "PointOnNurbs",
    /**
     * l1.x, l1.y, l2.x, l2.y, cp0…, w0…, t（变长 3n+5，t 末位，同上）
     */
    TangentLineNurbs: 36, "36": "TangentLineNurbs",
    /**
     * 曲线-曲线相切（双接触点参数式，见 `TangentCurveCurve`）：布局
     * [curve1…, t1, curve2…, t2]，t1/t2 为辅助接触点参数（Dimensionless，
     * 调用方创建并给初值，如两曲线最近点对投影）。以下 18 种组合按族序
     * Circle < Arc < Ellipse < Conic < Bezier < Nurbs 规范化（kind 自描述
     * 两段布局；圆族内部组合已有 tangentcc/tangentca/tangentaa，不走本族）。
     * Bézier 段定长（恒 8 参数），NURBS 段变长（3n，随 `nurbs` 结构数据）；
     * 曲线 1 为 NURBS（即 Nurbs-Nurbs）时分界同样由结构数据推出
     * c1.x, c1.y, r1, t1, ec.x, ec.y, em.x, em.y, en.x, en.y, t2
     */
    TangentCircleEllipse: 37, "37": "TangentCircleEllipse",
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, ec.x, ec.y, em.x, em.y, en.x, en.y, t2
     */
    TangentArcEllipse: 38, "38": "TangentArcEllipse",
    /**
     * c1.x, c1.y, r1, t1, s.x, s.y, c.x, c.y, e.x, e.y, rho, t2
     */
    TangentCircleConic: 39, "39": "TangentCircleConic",
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, s.x, s.y, c.x, c.y, e.x, e.y, rho, t2
     */
    TangentArcConic: 40, "40": "TangentArcConic",
    /**
     * c1.x, c1.y, r1, t1, bp0.x, bp0.y, …, bp3.x, bp3.y, t2（定长）
     */
    TangentCircleBezier: 41, "41": "TangentCircleBezier",
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, bp0…, t2（定长）
     */
    TangentArcBezier: 42, "42": "TangentArcBezier",
    /**
     * e1.c/m/n 各 (x, y), t1, e2.c/m/n 各 (x, y), t2
     */
    TangentEllipseEllipse: 43, "43": "TangentEllipseEllipse",
    /**
     * e1.c/m/n 各 (x, y), t1, s.x, s.y, c.x, c.y, e.x, e.y, rho, t2
     */
    TangentEllipseConic: 44, "44": "TangentEllipseConic",
    /**
     * e.c/m/n 各 (x, y), t1, bp0…, t2（定长）
     */
    TangentEllipseBezier: 45, "45": "TangentEllipseBezier",
    /**
     * co1.s/c/e 各 (x, y) + rho, t1, co2.s/c/e 各 (x, y) + rho, t2
     */
    TangentConicConic: 46, "46": "TangentConicConic",
    /**
     * co.s/c/e 各 (x, y) + rho, t1, bp0…, t2（定长）
     */
    TangentConicBezier: 47, "47": "TangentConicBezier",
    /**
     * bp0…, t1, bp′0…, t2（定长：两段各 8 参数）
     */
    TangentBezierBezier: 48, "48": "TangentBezierBezier",
    /**
     * c1.x, c1.y, r1, t1, cp0…, w0…, t2（变长：曲线 2 为 NURBS）
     */
    TangentCircleNurbs: 49, "49": "TangentCircleNurbs",
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, cp0…, w0…, t2（变长）
     */
    TangentArcNurbs: 50, "50": "TangentArcNurbs",
    /**
     * e.c/m/n 各 (x, y), t1, cp0…, w0…, t2（变长）
     */
    TangentEllipseNurbs: 51, "51": "TangentEllipseNurbs",
    /**
     * co.s/c/e 各 (x, y) + rho, t1, cp0…, w0…, t2（变长）
     */
    TangentConicNurbs: 52, "52": "TangentConicNurbs",
    /**
     * bp0…, t1, cp0…, w0…, t2（变长）
     */
    TangentBezierNurbs: 53, "53": "TangentBezierNurbs",
    /**
     * cp0…, w0…, t1, cp′0…, w′0…, t2（双变长 3n1+1+3n2+1：两段皆 NURBS，
     * 分界与各段控制点数由 `nurbs` 结构数据推出，不依赖 ParamKind）
     */
    TangentNurbsNurbs: 54, "54": "TangentNurbsNurbs",
});

/**
 * 求解器系统的 WASM 句柄。内部持有 `garlic::System`；
 * 同一实例贯穿编辑会话（docs/05「性能」）。
 */
export class WasmSystem {
    static __wrap(ptr) {
        const obj = Object.create(WasmSystem.prototype);
        obj.__wbg_ptr = ptr;
        WasmSystemFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSystemFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsystem_free(ptr, 0);
    }
    /**
     * 添加约束。params 布局见 `ConstraintKind` 文档（docs/05「ConstraintKind 枚举与 params 布局」表）。
     * 带 datum 的约束：`datum = Some(v)` 时顺手新建 datum 参数（此时
     * params 不含 datum 位；仅单 datum 约束支持此语法糖）；`datum = None`
     * 时 params 末位必须是已存在的 datum ParamId（多 datum 约束如 Fix
     * 必须走此路径，显式传齐全部 datum）。`driving` 决定 datum 是输入
     * （驱动）还是写回目标（从动）；无 datum 的约束只允许 driving = true。
     *
     * `branch` 仅对相切约束有效（其他 kind 必须为 None，否则报错）：
     * - None：按当前几何自动判定分支（TangentLC::detect / TangentCC::auto，
     *   圆弧相切 TangentLA/TangentAA/TangentCA 同）；
     * - Some(1)：显式正分支（TangentLineCircle/TangentLineArc = Positive，
     *   TangentCircleCircle/TangentArcArc = External）；
     * - Some(-1)：显式负分支（Negative / Internal）；
     * - 其他值报错。显式分支走 new_checked 校验：与当前几何矛盾时返回
     *   TangentBranchConflict。显式 Internal 时若 r1 < r2，new_checked
     *   自动交换两圆/两弧（TangentCircleArc 布局不对称无法交换，改为置 flip
     *   标志），维持 c1 为外圆（外弧）的内核约定（同 TangentCC::auto）。
     *
     * `nurbs` 仅对含 NURBS 的 kind 有效（其他 kind 必须为 None，否则报错）：
     * 给出每段 NURBS 的**结构性构造常量**（`{ degree, knots }`，按曲线在约束
     * 中的 canonical 序每段一项——Circle &lt; Arc &lt; Ellipse &lt; Conic &lt; Bezier
     * &lt; Nurbs，故 NURBS 段恒为末段；Nurbs-Nurbs 相切给两项）。
     * 控制点数由节点矢量长度反推（n = knots.length − degree − 1），权重是
     * 求解参数、照常放在 `params` 里（控制点后紧跟 n 个权重，t 仍在末位）。
     * 缺省的钳制均匀节点矢量即 `[0]×(degree+1) + [1, 2, …] + [n−degree]×(degree+1)`。
     *
     * datum 只读契约（同内核 `System::add_constraint` rustdoc）：datum 参数
     * 必须只经 `set_param` 从 JS 侧驱动，不得同时是任何约束的未知量或从动
     * 输出；违反时不报错，但其消费块读到的是求解前的旧值（下一次 solve
     * 自愈；循环共享永不静止）。
     * 返回 ConstraintId。
     * @param {ConstraintKind} kind
     * @param {Uint32Array} params
     * @param {number | null | undefined} datum
     * @param {boolean} driving
     * @param {number} tag
     * @param {number | null} [branch]
     * @param {NurbsSpec[] | null} [nurbs]
     * @returns {number}
     */
    add_constraint(kind, params, datum, driving, tag, branch, nurbs) {
        const ptr0 = passArray32ToWasm0(params, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(nurbs) ? 0 : passArrayJsValueToWasm0(nurbs, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_add_constraint(this.__wbg_ptr, kind, ptr0, len0, !isLikeNone(datum), isLikeNone(datum) ? 0 : datum, driving, tag, isLikeNone(branch) ? Number.MAX_SAFE_INTEGER : (branch) >> 0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * 批量新建参数。kinds: 0 = Coordinate, 1 = Length, 2 = Dimensionless。
     * 返回 ParamId 数组（Uint32Array）。
     * @param {Uint8Array} kinds
     * @param {Float64Array} values
     * @returns {Uint32Array}
     */
    add_params(kinds, values) {
        const ptr0 = passArray8ToWasm0(kinds, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_add_params(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * 拖拽协议·抬起：清除拖拽标记（内核语义为清空整个 dragged 集合，
     * ids 仅做存在性校验）；随后应调 `solve(true)` 精解
     * @param {Uint32Array} ids
     */
    clear_dragged(ids) {
        const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_clear_dragged(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 诊断：conflicting / redundant 约束清单与 DOF（先 solve 再 diagnose
     * 才有预期语义，见 diagnose 模块文档）。
     * @returns {DiagReportInfo}
     */
    diagnose() {
        const ret = wasm.wasmsystem_diagnose(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * 全系统自由度
     * @returns {number}
     */
    dofs() {
        const ret = wasm.wasmsystem_dofs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 自由参数（未被约束完全确定）的 id 列表，升序：全约束草图返回空
     * 数组。供前端按 SolidWorks 习惯给实体着色（全约束/欠约束）——
     * 实体全约束 ⟺ 其全部 ParamId 不在此列表。判定语义（行空间归属，
     * 不依赖残差，未求解的草图也可用）与成本见内核 `System::free_param_ids`。
     * @returns {Uint32Array}
     */
    free_param_ids() {
        const ret = wasm.wasmsystem_free_param_ids(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * 批量读回参数值（Float64Array）
     * @param {Uint32Array} ids
     * @returns {Float64Array}
     */
    get_params(ids) {
        const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_get_params(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * 从 Sketch 对象加载草图（静态方法；docs/04「序列化与互操作」）。`sketch` 可以是
     * `save_sketch` 返回对象的 `.sketch` 字段，或 JSON 落盘后的解析结果。
     * 格式版本不符/未知约束 kind/参数索引越界均报 JsError；入参结构形状不符
     * （缺字段/类型错误）在 ABI 边界的 serde 反序列化处直接抛异常。
     *
     * **句柄语义**：加载产生的是全新系统——参数/约束 id 从 0 重排、无
     * tombstone，旧 `WasmSystem` 实例的句柄（ParamId/ConstraintId）与
     * 新实例不可混用；旧实例本身不受影响，可继续使用。
     * @param {Sketch} sketch
     * @returns {WasmSystem}
     */
    static load_sketch(sketch) {
        const ret = wasm.wasmsystem_load_sketch(sketch);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSystem.__wrap(ret[0]);
    }
    /**
     * 拖拽协议·按下：先 set_param 预设鼠标位置，再调用本方法标记
     * （docs/05「导出 API 设计」；语义同 System::mark_dragged）
     * @param {Uint32Array} ids
     */
    mark_dragged(ids) {
        const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsystem_mark_dragged(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 新建空系统（JS 侧 `new WasmSystem()`）
     */
    constructor() {
        const ret = wasm.wasmsystem_new();
        this.__wbg_ptr = ret;
        WasmSystemFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 删除约束（tombstone，句柄不位移；重复删除报 UnknownConstraint）
     * @param {number} id
     */
    remove_constraint(id) {
        const ret = wasm.wasmsystem_remove_constraint(this.__wbg_ptr, id);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 删除参数（被活跃约束引用时报 ParamInUse，先删约束再删参数）
     * @param {number} id
     */
    remove_param(id) {
        const ret = wasm.wasmsystem_remove_param(this.__wbg_ptr, id);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 保存草图（docs/04「序列化与互操作」序列化，与 native `System::export_sketch`
     * 同一份格式定义）。返回 `{ sketch, skipped }` 对象：
     * - `sketch`：Sketch 文档（version/params/constraints），可直接交给
     *   `WasmSystem::load_sketch` 或 `JSON.stringify` 落盘；
     * - `skipped`：因未实现 `export_kind` 而被跳过的外部自定义约束 id
     *  （u32 数组）。数据不是错误——内建约束永不进此列表，正常为空；
     *   非空时导入结果的求解结局可能不同，调用方按需提示用户。
     * tombstone 与禁用 tag 组的约束不导出；dragged 等交互瞬态不保存。
     * @returns {SaveResultInfo}
     */
    save_sketch() {
        const ret = wasm.wasmsystem_save_sketch(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * 写单个参数值（未知 id 报错）
     * @param {number} id
     * @param {number} value
     */
    set_param(id, value) {
        const ret = wasm.wasmsystem_set_param(this.__wbg_ptr, id, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 求解。fine = true 精解（鼠标抬起/显式重解），false 粗解（拖拽每帧）。
     * @param {boolean} fine
     * @returns {SolveReportInfo}
     */
    solve(fine) {
        const ret = wasm.wasmsystem_solve(this.__wbg_ptr, fine);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) WasmSystem.prototype[Symbol.dispose] = WasmSystem.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_408e67f47ca7b58b: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_is_undefined_6cff064c44e0d823: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_d154f1e671052120: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_parse_1cc93481b0865939: function() { return handleError(function (arg0, arg1) {
            const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_stringify_f93a4ebae9231922: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./garlic_bg.js": import0,
    };
}

const WasmSystemFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsystem_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('garlic_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
