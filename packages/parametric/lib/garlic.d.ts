/* tslint:disable */
/* eslint-disable */
/**
 * NURBS 的参数无关结构数据（次数 + 节点矢量）。求解参数（控制点、权重）
 * 不进此结构——它是构造常量，随约束对象持有并经 `Constraint::structure()`
 * 与 `ConRec::nurbs` 序列化往返（docs/04「序列化与互操作」）。控制点数由
 * `knots.len() − degree − 1` 唯一确定，变长布局的分界即以此推导。
 */
export interface NurbsSpec {
    /**
     * 次数（≤ `MAX_DEGREE`）
     */
    degree: number;
    /**
     * 节点矢量（长度 = n + degree + 1）
     */
    knots: number[];
}

/**
 * `diagnose_by_removal` 的返回（camelCase 字段）。
 *
 * `trials` 是\"删掉哪一条能修复\"的定义级答案，与 `diagnose()` 的组**互补而非
 * 等价**：组按交集/并集启发式给\"相关行\"，会漏报单删可解项、也会在纠缠时
 * 过报（实测见 `tests/diagnose_vs_removal.rs` 模块文档）。`truncated` = 预算
 * 耗尽的部分结果，是数据不是错误。
 */
export interface RemovalReportInfo {
    /**
     * 试删前的基线诊断（分类的参照系）
     */
    baseline: DiagReportInfo;
    /**
     * 逐约束试删结果（按约束 id 升序，确定性顺序）
     */
    trials: RemovalTrialInfo[];
    /**
     * 预算耗尽、候选集中仍有未试删的约束
     */
    truncated: boolean;
}

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
 * 冲突来源（与内核 `diagnose::ConflictKind` 同构）：消费方按此换渲染口径——
 * `Rows` 给\"删谁\"的单删候选，`Guard` 给\"改驱动尺寸/放宽约束\
 */
export type ConflictKindInfo = "rows" | "guard";

/**
 * 冲突组（启发式候选，非删除保证，见 diagnose 模块文档）
 */
export interface ConflictGroupInfo {
    /**
     * 被判 conflicting 的约束 id
     */
    constraint: number;
    /**
     * 冲突来源（`Rows` 才可经试删确认元凶）
     */
    kind: ConflictKindInfo;
    /**
     * 冲突另一方候选（多行取交集；`Guard` 类恒空）
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
 * 单条约束的试删记录（camelCase 字段）
 */
export interface RemovalTrialInfo {
    /**
     * 被试删的约束 id
     */
    constraint: number;
    /**
     * 删除后的角色分类
     */
    effect: RemovalEffectInfo;
    /**
     * 删除后的全系统自由度
     */
    dofsAfter: number;
    /**
     * 删除后的冲突清单（与基线逐项比对用）
     */
    conflictingAfter: number[];
    /**
     * 删除后的冗余清单
     */
    redundantAfter: number[];
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
    /**
     * NURBS 段的结构性构造常量（`Constraint::structure()`）：次数 + 节点矢量，
     * 按曲线在约束中的 canonical 序每段一项（Nurbs-Nurbs 相切 2 项，单曲线
     * NURBS 约束 1 项）。`params` 只承载 ParamId，次数/节点矢量无法从参数表
     * 反推，故单独携带；不含 NURBS 的约束为 `None`（携带即报错）
     */
    nurbs?: NurbsSpec[];
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
 * 试删一条约束后的角色分类（serde 序列化为字符串字面量，同 `SolveResultInfo`）
 */
export type RemovalEffectInfo = "ConflictCulprit" | "RedundancySource" | "NoEffect";


/**
 * 内建约束枚举（docs/05「ConstraintKind 枚举与 params 布局」；params 布局严格等于各约束 `params()` 的顺序，
 * 带 datum 的约束 datum ParamId 占末位）。新增内建约束须同步加入本枚举、`layout` 与 `from_u32`。
 *
 * C ABI 判别值 = 本枚举的**隐式判别值**（声明序）= `from_u32` 表 = cbindgen
 * 头文件里 C 侧看到的数值（当前 0..=61，无空洞）。数值契约一经发布不得改动——
 * 新增约束接在末尾取新值。曲线族在 2026-10 由控制点 B 样条改为 Bézier +
 * NURBS：7 个原样条槽位**改义**为参数形状相同的 Bézier 对应项（0.1.0 未发布）。
 *
 * 判别值是**隐式**的（枚举无 `= N`，值即声明序），因此**插入/挪动变体会平移
 * 其后全部判别值**——这不是"解耦"，而是同一份数值的两个视图。防线是单测
 * `from_u32_matches_discriminants` 把枚举判别值与 `from_u32` 表逐项互锁（并
 * 断言从 0 起密集连续）：任何会改变既有数值的重排都会让它**立即报红**，不会
 * 静默漂移。但报红 ≠ 数值没变——发布后**新增只能接在末尾**，0.1 发布前是最后
 * 的重排窗口。历史事故：曲线族变体曾插错位置，与 `from_u32` 表（及 cbindgen
 * 头文件）错位 14 项（35..=48，仅 C/FFI 路径取错约束种类），正是该测试抓出。
 *
 * 声明序 = **几何族优先**的分类学（2026-10 六轮重排，0.1 未发布故不背兼容包袱）：
 * 点与通用 → 点-线 → 线-线 → 圆 → 弧 → 椭圆 → 圆锥 → Bézier → NURBS →
 * 曲线-曲线相切（18 组组合一段）；族内按**关系**排（尺寸/相等 → 点在…上 →
 * 线相切 → 族内组合）。各段边界见枚举体内的 `// ---- 段名 ----` 分隔注释。
 * 判别值**与声明序一致**（递增、从 0 起密集连续）：C 头文件、`from_u32` 表、
 * 源码三者同序，数值即可目视核对。
 * 重排动因是旧序的"添加史"性质：0..27 是 MVP 基础批、28..34 是椭圆/圆锥/
 * Bézier 批、35..46 与 49..54 是两批曲线相切组合、47/48 是 NURBS 的点/线两项
 * （编号均为重排前映射，见 docs/04 六轮条目）——同族被批次切开（`PointOnEllipse`
 * 与 `PointOnNurbs` 相距 19），组合段也被劈成两截。
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
     * p1.x, p1.y, p2.x, p2.y, datum（有向水平距离，末位）
     */
    HorizontalDistance = 2,
    /**
     * 同 HorizontalDistance（有向竖直距离）
     */
    VerticalDistance = 3,
    /**
     * p1.x, p1.y, p2.x, p2.y（同高度）
     */
    HorizontalAlign = 4,
    /**
     * p1.x, p1.y, p2.x, p2.y（同横坐标）
     */
    VerticalAlign = 5,
    /**
     * a, b
     */
    Equal = 6,
    /**
     * p.x, p.y, X0, Y0（2 个 datum ParamId 占末两位，无 Some(v) 语法糖）
     */
    Fix = 7,
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y
     */
    PointOnLine = 8,
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y, datum（末位）
     */
    P2LDistance = 9,
    /**
     * p.x, p.y, l1.x, l1.y, l2.x, l2.y
     */
    Midpoint = 10,
    /**
     * p1.x, p1.y, p2.x, p2.y, l1.x, l1.y, l2.x, l2.y
     */
    Symmetric = 11,
    /**
     * p1.x, p1.y, p2.x, p2.y（残差只用 y，x 两列是 Jacobian 结构零，但 params 仍需传齐 4 个）
     */
    Horizontal = 12,
    /**
     * 同 Horizontal
     */
    Vertical = 13,
    /**
     * l1.p1, l1.p2, l2.p1, l2.p2 各 (x, y)
     */
    Parallel = 14,
    /**
     * 同 Parallel
     */
    Perpendicular = 15,
    /**
     * l1.p1, l1.p2, l2.p1, l2.p2 各 (x, y), datum（弧度，末位）
     */
    Angle = 16,
    /**
     * l1 与 l2 的端点各 (x, y)
     */
    EqualLength = 17,
    /**
     * rad, datum（末位）
     */
    Radius = 18,
    /**
     * r1, r2
     */
    EqualRadius = 19,
    /**
     * p.x, p.y, c.x, c.y, rad
     */
    PointOnCircle = 20,
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, rad（branch 语义见 wasm/FFI 的 add_constraint）
     */
    TangentLineCircle = 21,
    /**
     * c1.x, c1.y, r1, c2.x, c2.y, r2（branch 语义见 wasm/FFI 的 add_constraint）
     */
    TangentCircleCircle = 22,
    /**
     * c1.x, c1.y, s1.x, s1.y, c2.x, c2.y, s2.x, s2.y
     */
    EqualArcRadius = 23,
    /**
     * p.x, p.y, c.x, c.y, s.x, s.y（s 为弧起点/半径参考点，r = ‖s−c‖）
     */
    PointOnArc = 24,
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, s.x, s.y（branch 语义同 TangentLineCircle）
     */
    TangentLineArc = 25,
    /**
     * c.x, c.y, rad, a.c.x, a.c.y, a.s.x, a.s.y（branch 语义同 TangentCircleCircle；
     * 内切且弧为外时内核自动置 flip，无需导出层指定）
     */
    TangentCircleArc = 26,
    /**
     * c1.x, c1.y, s1.x, s1.y, c2.x, c2.y, s2.x, s2.y（branch 语义同 TangentCircleCircle）
     */
    TangentArcArc = 27,
    /**
     * p.x, p.y, c.x, c.y, m.x, m.y, n.x, n.y（三点式椭圆：中心/长轴点/短轴点）
     */
    PointOnEllipse = 28,
    /**
     * l1.x, l1.y, l2.x, l2.y, c.x, c.y, m.x, m.y, n.x, n.y（branch 语义同 TangentLineCircle）
     */
    TangentLineEllipse = 29,
    /**
     * rho, datum（末位，无量纲）
     */
    ConicRho = 30,
    /**
     * p.x, p.y, s.x, s.y, c.x, c.y, e.x, e.y, rho, t（t 为辅助曲线参数，末位；
     * 调用方创建并给初值，如投影值）
     */
    PointOnConic = 31,
    /**
     * l1.x, l1.y, l2.x, l2.y, s.x, s.y, c.x, c.y, e.x, e.y, rho, t（t 末位；
     * 接触点式无 branch）
     */
    TangentLineConic = 32,
    /**
     * p.x, p.y, cp0.x, cp0.y, cp1.x, cp1.y, cp2.x, cp2.y, cp3.x, cp3.y, t
     * （定长 11：固定三次 Bézier 恒 4 个控制点，t 为辅助曲线参数，末位）
     */
    PointOnBezier = 33,
    /**
     * l1.x, l1.y, l2.x, l2.y, cp0.x, cp0.y, …, cp3.x, cp3.y, t（定长 13，t 末位）
     */
    TangentLineBezier = 34,
    /**
     * p.x, p.y, cp0.x, cp0.y, …, cp_{n−1}.x, cp_{n−1}.y, w0, …, w_{n−1}, t
     * （变长 3n+3：n 个控制点 + n 个有理权重 + 辅助曲线参数 t 末位；次数与
     * 节点矢量经 `nurbs` 入参给出，n 由节点矢量长度反推）
     */
    PointOnNurbs = 35,
    /**
     * l1.x, l1.y, l2.x, l2.y, cp0…, w0…, t（变长 3n+5，t 末位，同上）
     */
    TangentLineNurbs = 36,
    /**
     * 曲线-曲线相切（双接触点参数式，见 `TangentCurveCurve`）：布局
     * [curve1…, t1, curve2…, t2]，t1/t2 为辅助接触点参数（Dimensionless，
     * 调用方创建并给初值，如两曲线最近点对投影）。全部 18 种组合按族序
     * Circle < Arc < Ellipse < Conic < Bezier < Nurbs 规范化（kind 自描述
     * 两段布局；圆族内部组合已有 tangentcc/tangentca/tangentaa，不走本族）。
     * 本段**连续无插入**（判别值 37..=54）：族序对表与 kernel 的
     * `CURVE_TANGENT_COMBOS` 逐下标对齐，由单测 `combo_kinds_parallel_table_pinned`
     * 交叉钉住。
     * Bézier 段定长（恒 8 参数），NURBS 段变长（3n，随 `nurbs` 结构数据）；
     * 曲线 1 为 NURBS（即 Nurbs-Nurbs）时分界同样由结构数据推出
     * c1.x, c1.y, r1, t1, ec.x, ec.y, em.x, em.y, en.x, en.y, t2
     */
    TangentCircleEllipse = 37,
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, ec.x, ec.y, em.x, em.y, en.x, en.y, t2
     */
    TangentArcEllipse = 38,
    /**
     * c1.x, c1.y, r1, t1, s.x, s.y, c.x, c.y, e.x, e.y, rho, t2
     */
    TangentCircleConic = 39,
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, s.x, s.y, c.x, c.y, e.x, e.y, rho, t2
     */
    TangentArcConic = 40,
    /**
     * c1.x, c1.y, r1, t1, bp0.x, bp0.y, …, bp3.x, bp3.y, t2（定长）
     */
    TangentCircleBezier = 41,
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, bp0…, t2（定长）
     */
    TangentArcBezier = 42,
    /**
     * e1.c/m/n 各 (x, y), t1, e2.c/m/n 各 (x, y), t2
     */
    TangentEllipseEllipse = 43,
    /**
     * e1.c/m/n 各 (x, y), t1, s.x, s.y, c.x, c.y, e.x, e.y, rho, t2
     */
    TangentEllipseConic = 44,
    /**
     * e.c/m/n 各 (x, y), t1, bp0…, t2（定长）
     */
    TangentEllipseBezier = 45,
    /**
     * co1.s/c/e 各 (x, y) + rho, t1, co2.s/c/e 各 (x, y) + rho, t2
     */
    TangentConicConic = 46,
    /**
     * co.s/c/e 各 (x, y) + rho, t1, bp0…, t2（定长）
     */
    TangentConicBezier = 47,
    /**
     * bp0…, t1, bp′0…, t2（定长：两段各 8 参数）
     */
    TangentBezierBezier = 48,
    /**
     * c1.x, c1.y, r1, t1, cp0…, w0…, t2（变长：曲线 2 为 NURBS）
     */
    TangentCircleNurbs = 49,
    /**
     * a.c.x, a.c.y, a.s.x, a.s.y, t1, cp0…, w0…, t2（变长）
     */
    TangentArcNurbs = 50,
    /**
     * e.c/m/n 各 (x, y), t1, cp0…, w0…, t2（变长）
     */
    TangentEllipseNurbs = 51,
    /**
     * co.s/c/e 各 (x, y) + rho, t1, cp0…, w0…, t2（变长）
     */
    TangentConicNurbs = 52,
    /**
     * bp0…, t1, cp0…, w0…, t2（变长）
     */
    TangentBezierNurbs = 53,
    /**
     * cp0…, w0…, t1, cp′0…, w′0…, t2（双变长 3n1+1+3n2+1：两段皆 NURBS，
     * 分界与各段控制点数由 `nurbs` 结构数据推出，不依赖 ParamKind）
     */
    TangentNurbsNurbs = 54,
    /**
     * p.x, p.y, q.x, q.y, c.x, c.y, m.x, m.y, n.x, n.y（线 (p,q) 在椭圆接触端 p 处正交）
     */
    EllipseNormal = 55,
    /**
     * r1, r2, r3, r4（四圆半径差相等）
     */
    EqualOffsetC = 56,
    /**
     * c1,s1, c2,s2, c3,s3, c4,s4（四弧半径差相等）
     */
    EqualOffsetA = 57,
    /**
     * l1.p1, l1.p2, p1, l2.p1, l2.p2, p2（两对线距相等）
     */
    EqualOffsetL = 58,
    /**
     * b1.cp0…cp3, b2.cp0…cp3（Bézier–Bézier G2；branch 0..=3 编码接缝端）
     */
    CurvatureBB = 59,
    /**
     * b.cp0…cp3, l.p1, l.p2（Bézier–直线 G2）
     */
    CurvatureBL = 60,
    /**
     * b.cp0…cp3, a.center, a.start, a.end（Bézier–圆弧 G2）
     */
    CurvatureBA = 61,
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
     * `branch` 仅对相切族与 G2 曲率族有效（其他 kind 必须为 None，否则报错）：
     * - None：按当前几何自动判定（相切族走 TangentLC::detect / TangentCC::auto，
     *   圆弧相切 TangentLA/TangentAA/TangentCA 同；G2 曲率走 Curvature*::detect，
     *   取两端点距离最近的一对端）；
     * - 相切族 `Some(1)`：显式正分支（TangentLineCircle/TangentLineArc = Positive，
     *   TangentCircleCircle/TangentArcArc = External）；
     * - 相切族 `Some(-1)`：显式负分支（Negative / Internal）；
     * - G2 曲率族（CurvatureBB/CurvatureBL/CurvatureBA）`Some(1..=4)`：显式接缝端对
     *   ——1=(Start,Start)、2=(Start,End)、3=(End,Start)、4=(End,End)（Start = 曲线的
     *   t=0 端：Bézier 的 cp0 / 直线的 p1 / 圆弧的 start）。**0 编码留给"自动"**
     *   （与 FFI 的 `branch = 0` 一致），故端对从 1 起编号；
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
     */
    add_constraint(kind: ConstraintKind, params: Uint32Array, datum: number | null | undefined, driving: boolean, tag: number, branch?: number | null, nurbs?: NurbsSpec[] | null): number;
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
     * 逐约束试删诊断：给"删掉哪一条能修复"的定义级答案（SolveSpace 式兜底，
     * 见 `diagnose` 模块文档与 `tests/diagnose_vs_removal.rs` 的实测对照）。
     *
     * 只在用户主动追问时调用——成本约 O(候选数 × 一次诊断)，不要进每帧路径。
     * `budget` = 试删次数上限（`None` 不限）；耗尽时 `truncated` 为 true，
     * 未试删的约束不在 `trials` 里（部分结果是数据不是错误）。
     *
     * 语义：删后冲突/冗余清单清空才命中 `ConflictCulprit`/`RedundancySource`；
     * 多约束纠缠、无单删解时全部退化为 `NoEffect`。
     */
    diagnose_by_removal(budget?: number | null): RemovalReportInfo;
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
     * 整状态参数快照：一组 Float64Array，交给 [`Self::restore_params`] 还原。
     *
     * 拖拽的每帧都从这里重来一次，而不是从上一帧的解继续——那样几何会随指针走过
     * 的路径漂移，同一个终点位置因路径不同而得到不同的解。
     */
    params_snapshot(): Float64Array;
    /**
     * 删除约束（tombstone，句柄不位移；重复删除报 UnknownConstraint）
     */
    remove_constraint(id: number): void;
    /**
     * 删除参数（被活跃约束引用时报 ParamInUse，先删约束再删参数）
     */
    remove_param(id: number): void;
    /**
     * 还原 [`Self::params_snapshot`] 的快照，并把还原中变化的参数标记为待重解。
     */
    restore_params(values: Float64Array): void;
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
    readonly wasmsystem_add_constraint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly wasmsystem_add_params: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmsystem_clear_dragged: (a: number, b: number, c: number) => [number, number];
    readonly wasmsystem_diagnose: (a: number) => [number, number, number];
    readonly wasmsystem_diagnose_by_removal: (a: number, b: number) => [number, number, number];
    readonly wasmsystem_dofs: (a: number) => number;
    readonly wasmsystem_free_param_ids: (a: number) => [number, number];
    readonly wasmsystem_get_params: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmsystem_load_sketch: (a: any) => [number, number, number];
    readonly wasmsystem_mark_dragged: (a: number, b: number, c: number) => [number, number];
    readonly wasmsystem_new: () => number;
    readonly wasmsystem_params_snapshot: (a: number) => [number, number];
    readonly wasmsystem_remove_constraint: (a: number, b: number) => [number, number];
    readonly wasmsystem_remove_param: (a: number, b: number) => [number, number];
    readonly wasmsystem_restore_params: (a: number, b: number, c: number) => [number, number];
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
