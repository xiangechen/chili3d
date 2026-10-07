/* tslint:disable */
/* eslint-disable */
/**
 * `diagnose` 的返回（ConstraintId 展开为 u32；camelCase 字段）
 */
export interface DiagReportInfo {
    /**
     * 逐子系统诊断
     */
    subsystems: SubSystemDiagInfo[];
    /**
     * 被 substitution 消元的约束
     */
    substituted: number[];
    /**
     * 自由参数个数
     */
    freeParams: number;
    /**
     * 全系统自由度
     */
    dofs: number;
    /**
     * 冗余约束
     */
    redundant: number[];
    /**
     * 冲突约束
     */
    conflicting: number[];
    /**
     * 冲突组
     */
    conflictGroups: ConflictGroupInfo[];
    /**
     * 冗余组
     */
    redundantGroups: RedundantGroupInfo[];
}

/**
 * `save_sketch` 的返回：`sketch` 可直接交 `load_sketch`；`skipped` = 因未实现
 * `export_kind` 而被跳过的外部自定义约束 id（docs/04「序列化与互操作」的
 * 「数据不是错误」；内建约束永不进此列表）
 */
export interface SaveResultInfo {
    /**
     * 草图文档（version/params/constraints）
     */
    sketch: Sketch;
    /**
     * 被跳过的自定义约束 id
     */
    skipped: number[];
}

/**
 * `solve` 的返回（camelCase 字段）
 */
export interface SolveReportInfo {
    /**
     * 总体结局
     */
    result: SolveResultInfo;
    /**
     * 逐子系统结局
     */
    subResults: SolveResultInfo[];
    /**
     * 迭代数
     */
    iterations: number;
    /**
     * 参与求解的子系统数
     */
    subsystemsSolved: number;
}

/**
 * solve 结局（serde 序列化为字符串字面量，TS 侧为字符串联合类型）。
 * 本模块所有 `*Info` 类型的 TS 声明都由 Tsify 派生从字段类型自动注入 d.ts，
 * 改字段即改 d.ts，无需手工同步
 */
export type SolveResultInfo = "Ok" | "OkUnderconstrained" | "Conflicting" | "Diverged" | "Stalled";

/**
 * 冗余组（启发式候选）
 */
export interface RedundantGroupInfo {
    /**
     * 被判 redundant 的约束 id
     */
    constraint: number;
    /**
     * 推出它的来源约束（各行并集）
     */
    sources: number[];
}

/**
 * 冲突组（启发式候选，非删除保证，见 diagnose 模块文档）
 */
export interface ConflictGroupInfo {
    /**
     * 被判 conflicting 的约束 id
     */
    constraint: number;
    /**
     * 冲突另一方候选（多行取交集）
     */
    counterparts: number[];
    /**
     * 失配量级（约束自身残差单位）
     */
    mismatch: number;
}

/**
 * 单子系统诊断（camelCase 字段）
 */
export interface SubSystemDiagInfo {
    /**
     * 子系统内约束
     */
    constraints: number[];
    /**
     * 冗余约束
     */
    redundant: number[];
    /**
     * 冲突约束
     */
    conflicting: number[];
    /**
     * 冲突组
     */
    conflictGroups: ConflictGroupInfo[];
    /**
     * 冗余组
     */
    redundantGroups: RedundantGroupInfo[];
    /**
     * 子系统自由度
     */
    dofs: number;
}

/**
 * 参数记录：量纲类别 + 当前值
 */
export interface ParamRec {
    /**
     * 量纲类别
     */
    kind: ParamKind;
    /**
     * 当前值
     */
    value: number;
}

/**
 * 参数量纲类别，供 scaling 估计特征长度 L（docs/03「`scaling.rs`」）。
 * serde 序列化供草图格式使用（docs/04「序列化与互操作」，serialize/wasm feature 门控）；
 * wasm feature 下派生 Tsify，TS 类型自动注入 pkg 的 d.ts
 */
export type ParamKind = "Coordinate" | "Length" | "Dimensionless";

/**
 * 约束记录：类型标签 + 参数索引 + driving/tag/相切分支
 */
export interface ConRec {
    /**
     * `Constraint::export_kind()` 的类型标签（如「distance」「tangentlc」）
     */
    kind: string;
    /**
     * 参数索引（指向 `Sketch::params` 的下标），布局 = 该约束 `params()` 顺序
     */
    params: number[];
    /**
     * 驱动（datum 是输入）/ 从动（datum 求解后闭式写回）
     */
    driving: boolean;
    /**
     * 分组标签（`TagId` 的原始 i32）
     */
    tag: number;
    /**
     * 附加 token（`export_extra()`）：相切分支 positive/negative、
     * external/internal；其余约束为 `None`
     */
    extra: string | null;
}

/**
 * 草图文档：参数表 + 约束表（字段语义见模块文档「格式」节；wasm feature 下
 * 派生 Tsify，`save_sketch`/`load_sketch` 的 TS 类型自动从本结构体生成）
 */
export interface Sketch {
    /**
     * 格式版本号，导出恒为 [`SKETCH_FORMAT_VERSION`]
     */
    version: number;
    /**
     * 参数表：数组下标即参数 id（约束以此下标引用）
     */
    params: ParamRec[];
    /**
     * 约束表（活跃约束，声明序）
     */
    constraints: ConRec[];
}


/**
 * 内建约束枚举（docs/05「ConstraintKind 枚举与 params 布局」；params 布局严格等于各约束 `params()` 的顺序，
 * 带 datum 的约束 datum ParamId 占末位）。新增内建约束须同步加入本枚举、`layout` 与 `from_u32`。
 *
 * C ABI 判别值由 `from_u32` 固定（当前 0..=27），与枚举声明顺序解耦——
 * 调整顺序不会破坏已发布的 FFI 数值契约。
 */
export enum ConstraintKind {
    /**
     * p1.x, p1.y, p2.x, p2.y
     */
    P2PCoincident = 0,
    /**
     * p1.x, p1.y, p2.x, p2.y, distance（datum 末位）
     */
    P2PDistance = 1,
    /**
     * a, b
     */
    Equal = 2,
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y
     */
    PointOnLine = 3,
    /**
     * p1.x, p1.y, p2.x, p2.y（残差只用 y，x 两列是 Jacobian 结构零，但 params 仍需传齐 4 个）
     */
    Horizontal = 4,
    /**
     * 同 Horizontal
     */
    Vertical = 5,
    /**
     * l1.p1, l1.p2, l2.p1, l2.p2 各 (x, y)
     */
    Parallel = 6,
    /**
     * 同 Parallel
     */
    Perpendicular = 7,
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y, datum（末位）
     */
    P2LDistance = 8,
    /**
     * l1.p1, l1.p2, l2.p1, l2.p2 各 (x, y), datum（弧度，末位）
     */
    Angle = 9,
    /**
     * rad, datum（末位）
     */
    Radius = 10,
    /**
     * l1 与 l2 的端点各 (x, y)
     */
    EqualLength = 11,
    /**
     * r1, r2
     */
    EqualRadius = 12,
    /**
     * p.x, p.y, c.x, c.y, rad
     */
    PointOnCircle = 13,
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y
     */
    Midpoint = 14,
    /**
     * p1.x, p1.y, p2.x, p2.y, l1.x, l1.y, l2.x, l2.y
     */
    Symmetric = 15,
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, rad（branch 语义见 wasm/FFI 的 add_constraint）
     */
    TangentLineCircle = 16,
    /**
     * c1.x, c1.y, r1, c2.x, c2.y, r2（branch 语义见 wasm/FFI 的 add_constraint）
     */
    TangentCircleCircle = 17,
    /**
     * p1.x, p1.y, p2.x, p2.y, datum（有向水平距离，末位）
     */
    HorizontalDistance = 18,
    /**
     * 同 HorizontalDistance（有向竖直距离）
     */
    VerticalDistance = 19,
    /**
     * p1.x, p1.y, p2.x, p2.y（同高度）
     */
    HorizontalAlign = 20,
    /**
     * p1.x, p1.y, p2.x, p2.y（同横坐标）
     */
    VerticalAlign = 21,
    /**
     * p.x, p.y, X0, Y0（2 个 datum ParamId 占末两位，无 Some(v) 语法糖）
     */
    Fix = 22,
    /**
     * p.x, p.y, c.x, c.y, s.x, s.y（s 为弧起点/半径参考点，r = ‖s−c‖）
     */
    PointOnArc = 23,
    /**
     * c1.x, c1.y, s1.x, s1.y, c2.x, c2.y, s2.x, s2.y
     */
    EqualArcRadius = 24,
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, s.x, s.y（branch 语义同 TangentLineCircle）
     */
    TangentLineArc = 25,
    /**
     * c1.x, c1.y, s1.x, s1.y, c2.x, c2.y, s2.x, s2.y（branch 语义同 TangentCircleCircle）
     */
    TangentArcArc = 26,
    /**
     * c.x, c.y, rad, a.c.x, a.c.y, a.s.x, a.s.y（branch 语义同 TangentCircleCircle；
     * 内切且弧为外时内核自动置 flip，无需导出层指定）
     */
    TangentCircleArc = 27,
}

/**
 * 求解器系统的 WASM 句柄。内部持有 `garlic::System`；
 * 同一实例贯穿编辑会话（docs/05「性能」）。
 */
export class WasmSystem {
    free(): void;
    [Symbol.dispose](): void;
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
     * datum 只读契约（同内核 `System::add_constraint` rustdoc）：datum 参数
     * 必须只经 `set_param` 从 JS 侧驱动，不得同时是任何约束的未知量或从动
     * 输出；违反时不报错，但其消费块读到的是求解前的旧值（下一次 solve
     * 自愈；循环共享永不静止）。
     * 返回 ConstraintId。
     */
    add_constraint(kind: ConstraintKind, params: Uint32Array, datum: number | null | undefined, driving: boolean, tag: number, branch?: number | null): number;
    /**
     * 批量新建参数。kinds: 0 = Coordinate, 1 = Length, 2 = Dimensionless。
     * 返回 ParamId 数组（Uint32Array）。
     */
    add_params(kinds: Uint8Array, values: Float64Array): Uint32Array;
    /**
     * 拖拽协议·抬起：清除拖拽标记（内核语义为清空整个 dragged 集合，
     * ids 仅做存在性校验）；随后应调 `solve(true)` 精解
     */
    clear_dragged(ids: Uint32Array): void;
    /**
     * 诊断：conflicting / redundant 约束清单与 DOF（先 solve 再 diagnose
     * 才有预期语义，见 diagnose 模块文档）。
     */
    diagnose(): DiagReportInfo;
    /**
     * 全系统自由度
     */
    dofs(): number;
    /**
     * 自由参数（未被约束完全确定）的 id 列表，升序：全约束草图返回空
     * 数组。供前端按 SolidWorks 习惯给实体着色（全约束/欠约束）——
     * 实体全约束 ⟺ 其全部 ParamId 不在此列表。判定语义（行空间归属，
     * 不依赖残差，未求解的草图也可用）与成本见内核 `System::free_param_ids`。
     */
    free_param_ids(): Uint32Array;
    /**
     * 批量读回参数值（Float64Array）
     */
    get_params(ids: Uint32Array): Float64Array;
    /**
     * 从 Sketch 对象加载草图（静态方法；docs/04「序列化与互操作」）。`sketch` 可以是
     * `save_sketch` 返回对象的 `.sketch` 字段，或 JSON 落盘后的解析结果。
     * 格式版本不符/未知约束 kind/参数索引越界均报 JsError；入参结构形状不符
     * （缺字段/类型错误）在 ABI 边界的 serde 反序列化处直接抛异常。
     *
     * **句柄语义**：加载产生的是全新系统——参数/约束 id 从 0 重排、无
     * tombstone，旧 `WasmSystem` 实例的句柄（ParamId/ConstraintId）与
     * 新实例不可混用；旧实例本身不受影响，可继续使用。
     */
    static load_sketch(sketch: Sketch): WasmSystem;
    /**
     * 拖拽协议·按下：先 set_param 预设鼠标位置，再调用本方法标记
     * （docs/05「导出 API 设计」；语义同 System::mark_dragged）
     */
    mark_dragged(ids: Uint32Array): void;
    /**
     * 新建空系统（JS 侧 `new WasmSystem()`）
     */
    constructor();
    /**
     * 删除约束（tombstone，句柄不位移；重复删除报 UnknownConstraint）
     */
    remove_constraint(id: number): void;
    /**
     * 删除参数（被活跃约束引用时报 ParamInUse，先删约束再删参数）
     */
    remove_param(id: number): void;
    /**
     * 保存草图（docs/04「序列化与互操作」序列化，与 native `System::export_sketch`
     * 同一份格式定义）。返回 `{ sketch, skipped }` 对象：
     * - `sketch`：Sketch 文档（version/params/constraints），可直接交给
     *   `WasmSystem::load_sketch` 或 `JSON.stringify` 落盘；
     * - `skipped`：因未实现 `export_kind` 而被跳过的外部自定义约束 id
     *  （u32 数组）。数据不是错误——内建约束永不进此列表，正常为空；
     *   非空时导入结果的求解结局可能不同，调用方按需提示用户。
     * tombstone 与禁用 tag 组的约束不导出；dragged 等交互瞬态不保存。
     */
    save_sketch(): SaveResultInfo;
    /**
     * 写单个参数值（未知 id 报错）
     */
    set_param(id: number, value: number): void;
    /**
     * 求解。fine = true 精解（鼠标抬起/显式重解），false 粗解（拖拽每帧）。
     */
    solve(fine: boolean): SolveReportInfo;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmsystem_free: (a: number, b: number) => void;
    readonly wasmsystem_add_constraint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly wasmsystem_add_params: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmsystem_clear_dragged: (a: number, b: number, c: number) => [number, number];
    readonly wasmsystem_diagnose: (a: number) => [number, number, number];
    readonly wasmsystem_dofs: (a: number) => number;
    readonly wasmsystem_free_param_ids: (a: number) => [number, number];
    readonly wasmsystem_get_params: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmsystem_load_sketch: (a: any) => [number, number, number];
    readonly wasmsystem_mark_dragged: (a: number, b: number, c: number) => [number, number];
    readonly wasmsystem_new: () => number;
    readonly wasmsystem_remove_constraint: (a: number, b: number) => [number, number];
    readonly wasmsystem_remove_param: (a: number, b: number) => [number, number];
    readonly wasmsystem_save_sketch: (a: number) => [number, number, number];
    readonly wasmsystem_set_param: (a: number, b: number, c: number) => [number, number];
    readonly wasmsystem_solve: (a: number, b: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
