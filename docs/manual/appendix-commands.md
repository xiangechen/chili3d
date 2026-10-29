# 附录 A 命令速查表

“键”一列是命令内部键（用于排查、插件开发和 AI 引用）；界面以中文按钮为准。带快捷键的见 [附录 B](appendix-shortcuts.md)。

> 少数命令没有独立的功能区按钮，入口在别处：
>
> - `feature.reselect` 在参数化体的特征行 `⋯` 菜单里；
> - `create.thickSolid`（加厚实体）、`create.refSegment`（参考线段）、`feature.sew`（参数化缝合）在 v0.8.0 中已注册，但没有功能区入口，只能通过插件或脚本按命令键调用。

## A.1 基本标签

### 绘制

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 直线 | `create.line` | 连续画线；可关闭“相连” |
| 矩形 | `create.rect` | 两角点；可键入 `宽,高` |
| 圆形 | `create.circle` | 圆心 + 半径 |
| 椭圆 | `create.ellipse` | 中心 + 长轴 + 短轴 |
| 正多边形 | `create.regularPolygon` | 中心 + 半径；默认 6 边 |
| 圆弧 | `create.arc` | 圆心 + 起点 + 终点 |
| 两点圆弧 | `create.arc2point` | 起点 + 终点 + 弧高 |
| 三点圆弧 | `create.arc3point` | 起点 + 中间点 + 终点 |
| 相切相切半径圆弧 | `create.arcTTR` | 两条边 + 半径 |
| 立方体 | `create.box` | 底面两角点 + 高度 |
| 球体 | `create.sphere` | 球心 + 半径 |
| 圆柱 | `create.cylinder` | 圆心 + 半径 + 高度 |
| 圆锥 | `create.cone` | 圆心 + 半径 + 高度 |
| 棱锥 | `create.pyramid` | 底面两角点 + 高度 |
| 挤出 | `create.extrude` | 拾取面/轮廓 + 距离 |
| 放样 | `create.loft` | 多截面；实体/直纹/连续性 |
| 戈登曲面 | `create.gordon` | 轮廓边 + 引导边 |
| 扫略 | `create.sweep` | 截面 + 路径 |
| 旋转 | `create.revol` | 截面 + 轴 + 角度 |
| 点 | `create.point` | 单击放置 |
| 多段线 | `create.polygon` | 连续点；可闭合 |
| 贝塞尔曲线 | `create.bezier` | 连续控制点 |
| 螺旋线 | `create.helix` | 圆心 + 半径 + 高度；螺距 |
| 管状体 | `create.pipe` | 折线路径 + 半径 |
| 文字 | `create.text` | 字体/字高/内容/放置方式 + 位置 + 深度 |

### 修改

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 移动 | `modify.move` | 基点 + 目标点；可复制 |
| 旋转 | `modify.rotate` | 中心 + 参考点 + 角度点；可复制 |
| 镜像 | `modify.mirror` | 镜像线两点；可复制 |
| 阵列 | `modify.array` | 线形/环形/沿曲线/矩形；可编组 |
| 修剪 | `modify.trim` | 点掉要删除的段；连续执行 |
| 延伸 | `modify.extend` | 目标边 + 边界 |
| 抽壳 | `modify.shell` | 实体 + 开口面 + 厚度 |
| 分割 | `modify.split` | 形状 + 切割工具 |
| 缝合 | `modify.sew` | 面/壳按容差缝合 |
| 简化 | `modify.simplifyShape` | 移除共面边/面 |
| 圆角 | `modify.fillet` | 边 + 半径 |
| 倒角 | `modify.chamfer` | 边 + 长度 |
| 分解 | `modify.explode` | 拆成直接子形状 |
| 删除 | `modify.deleteNode` | 删除整个节点 |
| 删除子元素 | `modify.removeShapes` | 删除选中边/面并重建 |
| 删除特征 | `modify.removeFeature` | 移除生成某面的特征 |
| 打断 | `modify.break` | 边 + 打断点 |
| 油漆桶 | `modify.paintBucket` | 整个节点换材质 |
| 添加画笔 | `modify.brushAdd` | 给选中面加材质 |
| 删除画笔 | `modify.brushRemove` | 移除选中面的材质 |
| 清除画笔 | `modify.brushClear` | 清除节点的逐面材质 |
| 修复形状 | `modify.repairShape` | ShapeFix 修复 |
| 检查形状 | `modify.checkShape` | 逐面有效性检查 |

### 转换 / 布尔 / 工作平面 / 工具

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 转多段线 | `convert.toWire` | 边/线框 → 线框节点 |
| 转组合体 | `convert.toCompound` | 多形状 → 组合体 |
| 转为面 | `convert.toFace` | 边/线框围成面 |
| 转为壳 | `convert.toShell` | 面缝合成壳 |
| 转为体 | `convert.toSolid` | 闭合壳 → 实体 |
| 交集 | `boolean.common` | 目标 ∩ 工具 |
| 减去 | `boolean.cut` | 目标 − 工具 |
| 合并 | `boolean.join` | 目标 ∪ 工具 |
| 动态工作平面 | `workingPlane.toggleDynamic` | 开关自动选面 |
| 设置工作平面 | `workingPlane.set` | XOY / YOZ / ZOX |
| 对齐到平面 | `workingPlane.alignToPlane` | 拾取平面作为工作平面 |
| 从截面创建 | `workingPlane.fromSection` | 边 + 点，垂直工作平面 |
| 曲线投影 | `convert.curveProjection` | 曲线 + 面 + 方向 |
| 创建组 | `create.group` | 对象移入组件定义；可生成组件节点，不是树文件夹 |
| 相交曲线 | `create.section` | 两形状求交线 |
| 偏移 | `create.offset` | 边/线框/面 + 距离；连接类型 |
| 复制形状 | `create.copyShape` | 复制选中边/面 |

### 测量 / 注释 / 场景 / 文件 / 其他

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 长度 | `measure.length` | 两点距离 |
| 角度 | `measure.angle` | 顶点 + 两点 |
| 选择 | `measure.select` | 汇总长度/面积/体积 |
| 尺寸 | `annotate.dimension` | 两点 + 标注位置 |
| 半径 | `annotate.radius` | 圆/圆弧 + 位置 |
| 直径 | `annotate.diameter` | 圆/圆弧 + 位置 |
| 角度 | `annotate.angle` | 两条直线边 + 位置 |
| 文字 | `annotate.text` | 引线点 + 文字位置 |
| 从相机创建 | `act.alignCamera` | 保存当前视角为书签 |
| 导入 | `file.import` | STEP/IGES/BREP/STL |
| 导出 | `file.export` | STEP/IGES/BREP/STL/PLY/OBJ |
| 微信群 | `wechat.group` | 二维码 |
| AI 助手 | `ai.toggleChat` | 开关右侧面板 |

## A.2 参数化标签

### 草图与创建

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 新建草图 | `sketch.create` | 选基准面/实体平面后进入草图 |
| 编辑草图 | `sketch.enter` | 选已有草图 |
| 退出草图 | `sketch.exit` | 结束草图会话 |
| 基准面 | `feature.plane` | 7 种定义方式 |
| 立方体 | `feature.primitiveBox` | 长/宽/高；可布尔 |
| 圆柱 | `feature.primitiveCylinder` | 半径/高度；可布尔 |
| 球体 | `feature.primitiveSphere` | 半径；可布尔 |
| 圆锥 | `feature.primitiveCone` | 半径/顶半径/高度；可布尔 |
| 拉伸 | `feature.extrude` | 操作/四种终止条件/对称/深度 2/起止偏移/拔模；详见 [第 6 章](06-parametric-modeling.md) |
| 旋转 | `feature.revolve` | 角度/角度 2/对称/操作 |
| 放样 | `feature.loft` | 实体/直纹/连续性/操作 |
| 扫掠 | `feature.sweep` | 截面 + 多段路径；路径圆角、三种轮廓控制；详见 [第 6 章](06-parametric-modeling.md) |
| 加厚 | `feature.thicken` | 厚度/厚度 2/对称/反向 |
| 筋 | `feature.rib` | 开放边线 + 厚度 + 延伸 |
| 螺旋线 | `feature.helix` | 半径/长度/螺距 |

### 特征

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 推拉 | `feature.pressPull` | 按拾取对象转交拉伸/偏移面/修改圆角/修改倒角 |
| 圆角 | `feature.fillet` | 边 + 半径（可末端半径） |
| 倒角 | `feature.chamfer` | 等距离/双距离/距离角度 |
| 修改圆角 | `feature.modifyFillet` | 选圆角面改半径 |
| 修改倒角 | `feature.modifyChamfer` | 选倒角面改距离 |
| 拔模 | `feature.draft` | 中性面 + 面 + 角度 |
| 抽壳 | `feature.shell` | 开口面 + 厚度/向外 |
| 偏移面 | `feature.offsetFace` | 面 + 距离；保持圆角 |
| 分割 | `feature.split` | 工具 + 保留侧 |
| 孔 | `feature.hole` | 简单/沉孔/锥沉孔、草图点孔心、贯通/盲孔、M 系列预设；详见 [第 6 章](06-parametric-modeling.md) |
| 移除特征 | `feature.removeFeature` | 选特征面移除 |
| 线性阵列 | `feature.patternLinear` | 方向/间距/数量/第二方向 |
| 环形阵列 | `feature.patternCircular` | 轴/角度/数量/均布 |
| 曲线阵列 | `feature.patternCurve` | 路径/间距/取向 |
| 镜像 | `feature.mirror` | 镜像平面 + 合并 |
| 合并 | `feature.fuse` | 布尔并 |
| 减去 | `feature.cut` | 布尔差 |
| 交集 | `feature.common` | 布尔交 |
| 重新选择 | `feature.reselect` | 重拾失效引用；支持范围随特征而异 |

### 节点操作与其他

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 移动 | `modify.move` | 对体做整体变换 |
| 旋转 | `modify.rotate` | 同上 |
| 镜像 | `modify.mirror` | 同上 |
| 阵列 | `modify.array` | 同上；数量通常包含源对象 |
| 使独立 | `modify.detach` | 实例 → 独立副本 |
| 删除 | `modify.deleteNode` | 删除体 |
| 油漆桶 | `modify.paintBucket` | 整体换材质 |
| 变量 | `feature.variable` | 底部空行新增；长度/角度/无量纲表达式 |
| 注释 | `annotate.*` | 同基本标签 |
| 导入/导出 | `file.*` | 同基本标签 |
| AI 助手 | `ai.toggleChat` | 开关面板 |

## A.3 草图标签

### 绘制

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 直线 | `sketch.line` | 连续链；带自动水平/竖直 |
| 圆 | `sketch.circle` | 圆心 + 半径 |
| 椭圆 | `sketch.ellipse` | 中心 + 长轴 + 短轴 |
| 圆弧 | `sketch.arc` | 圆心 + 起点 + 终点（逆时针） |
| 椭圆弧 | `sketch.ellipseArc` | 椭圆 + 起点 + 终点 |
| 矩形 | `sketch.rectangle` | 两角点；自动约束 |
| 多边形 | `sketch.polygon` | 边数 + 内接/外切 |
| 样条 | `sketch.nurbs` | 控制点样条 |
| 贝塞尔 | `sketch.bezier` | 四点三次贝塞尔 |
| 圆锥 | `sketch.conic` | 起点/终点/控制点/肩点（rho） |
| 点 | `sketch.point` | 放置点 |
| 文字 | `sketch.text` | 内容/字高/字体 + 位置 + 顶部点 |

### 约束 / 标注

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 重合 | `constraint.coincident` | 两点重合 |
| 固定 | `constraint.fix` | 锁定几何 |
| 水平 | `constraint.horizontal` | 线水平 |
| 竖直 | `constraint.vertical` | 线竖直 |
| 平行 | `constraint.parallel` | 两线平行 |
| 垂直 | `constraint.perpendicular` | 两线垂直 |
| 相等 | `constraint.equal` | 等长/等半径 |
| 相切 | `constraint.tangent` | 曲线相切 |
| 对称 | `constraint.symmetric` | 关于轴对称 |
| 中点 | `constraint.midpoint` | 点在线上中点 |
| 点在线上 | `constraint.pointOn` | 点位于曲线上 |
| 水平对齐 | `constraint.horizontalAlign` | y 相同 |
| 竖直对齐 | `constraint.verticalAlign` | x 相同 |
| 驱动 / 从动 | `constraint.toggleDriven` | 切换尺寸类型 |
| 尺寸 | `dimension` | 智能尺寸 |
| 距离 | `dimension.distance` | 两点/两线距离 |
| 半径 | `dimension.radius` | 半径 |
| 角度 | `dimension.angle` | 两线夹角 |
| 点线距离 | `dimension.pointLineDistance` | 点到线 |
| 水平距离 | `dimension.horizontalDistance` | 水平投影距离 |
| 竖直距离 | `dimension.verticalDistance` | 竖直投影距离 |

### 修改 / 其他

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 圆角 | `sketch.fillet` | 两实体 + 半径 |
| 倒角 | `sketch.chamfer` | 两实体 + 长度 |
| 偏移 | `sketch.offset` | 实体 + 距离；徽标可改 |
| 修剪 | `sketch.trim` | 点掉一段 |
| 延伸 | `sketch.extend` | 实体 + 边界 |
| 打断 | `sketch.break` | 实体 + 点；封闭曲线两点 |
| 镜像 | `sketch.mirror` | 实体 + 镜像线 |
| 变换 | `sketch.transform` | 拖控制柄；Enter 确认 |
| 阵列 | `sketch.array` | 线形/环形/沿曲线；徽标/解散 |
| 约束列表 | `sketch.constraints` | 浮层面板 |
| 投影边线 | `sketch.projectEdges` | 共面边投影 |
| 切换外部参考 | `sketch.toggleExternal` | 参考 ↔ 轮廓 |
| 切换构造线 | `sketch.toggleConstruction` | 普通 ↔ 构造 |
| 退出草图 | `sketch.exit` | 结束会话 |

## A.4 文档与系统

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 新建文档 | `doc.new` | 新文档（标题栏 `+`） |
| 打开文档 | `doc.open` | 读取 `.cd` |
| 保存文档 | `doc.save` | 存入 IndexedDB |
| 保存到文件 | `doc.saveToFile` | 下载 `.cd` |
| 撤销 | `edit.undo` | Ctrl+Z |
| 重做 | `edit.redo` | Ctrl+Y / Ctrl+Shift+Z |
| 文件夹 | `create.folder` | 在项目树建文件夹 |
| 上个命令 | `special.last` | Space / Enter |
| 性能测试 | `test.performance` | 8000 盒基准测试 |

### 已注册但没有功能区按钮的命令

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 加厚实体 | `create.thickSolid` | 把面/壳加厚成实体 |
| 参考线段 | `create.refSegment` | 两点之间的虚线参考线段（注释） |
| 参数化缝合 | `feature.sew` | 把参数化体的面/壳按容差缝合 |
| 重新选择 | `feature.reselect` | 从特征行菜单进入 |

## A.5 Pro 编辑标签

仅 **Chili3D Pro** 提供。双击模型进入直接编辑后才会显示该上下文标签；命令只处理当前可编辑节点。操作步骤和转换影响见 [第 13 章](13-pro-direct-editing.md)。

### 分割

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 线 | `edit.lineSplit` | 起点 + 终点；连续绘制并分割 |
| 圆弧 | `edit.arcSplit` | 圆心 + 起点 + 角度点 |
| 2点圆弧 | `edit.arc2PointSplit` | 起点 + 终点 + 弧高点 |
| 3点圆弧 | `edit.arc3PointSplit` | 起点 + 弧上点 + 终点 |
| 相切相切半径圆弧 | `edit.arcTTRSplit` | 两条边 + 半径 |
| 圆 | `edit.circleSplit` | 圆心 + 半径点 |
| 椭圆 | `edit.ellipseSplit` | 中心 + 长轴端点 + 短轴端点 |
| 矩形 | `edit.rectSplit` | 两角点；可设中心矩形 |
| 多边形 | `edit.polygonSplit` | 中心 + 半径点 + 边数 |
| 偏移 | `edit.offsetSplit` | 面外环 + 偏移距离；可设连接类型 |

除 `偏移` 外，上述绘制命令的 `辅助线` 选项把结果保存为不切割实体的虚线参考边。

### 修改

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 移动 | `edit.move` | 同类面或边 + 基点 + 目标点；重建相邻面 |
| 复制 | `edit.copySplit` | 选边 + 两点；复制分割线，原边保留 |
| 旋转 | `edit.rotateSplit` | 选边 + 中心 + 参考点 + 角度点 |
| 镜像 | `edit.mirrorSplit` | 选边 + 镜像线两点 |
| 阵列 | `edit.arraySplit` | 选边并按阵列复制分割线；矩形阵列仅 X/Y |

### 工具与管理

| 命令 | 键 | 说明 |
| --- | --- | --- |
| 推拉 | `edit.pushpull` | 平面 + 法线上的目标点；Alt 切换新面模式 |
| 偏移面 | `edit.offsetFace` | 一个或多个面 + 带符号距离；可保持圆角半径 |
| 简化 | `edit.simplify` | 清理小面及可简化的共面/共线几何 |
| 修复 | `edit.fix` | 缝合、修复形状并清理小面 |
| 圆角 | `edit.fillet` | 当前节点的边 + 半径 |
| 倒角 | `edit.chamfer` | 当前节点的边 + 长度 |
| 特征删除 | `edit.removeFeature` | 选局部特征面并尝试愈合邻面 |
| 编辑设置 | `edit.settings` | 隔离模式、拖拽编辑圆角 |
| 退出 | `edit.exit` | 退出直接编辑，不撤销也不自动保存 |

---

回到 [手册目录](README.md) · 查 [附录 B 快捷键](appendix-shortcuts.md) · [附录 C 术语表](appendix-glossary.md)
