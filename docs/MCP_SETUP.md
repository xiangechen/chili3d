# Chili3D MCP — Setup Guide

> Let an AI (e.g. Claude Desktop) generate and edit 3D models over MCP. The
> model shares the **same OCCT geometry core** as the browser app, and the AI's
> output is a **parametric `.cd` node tree** that opens in the app for further
> editing — not a dead mesh.
>
> 讓 AI(例如 Claude Desktop)透過 MCP 生成、編輯 3D 模型。模型與瀏覽器 App
> **共用同一顆 OCCT 幾何核心**,AI 產出的是**參數化 `.cd` 節點樹**(可在 App
> 打開續編),不是死 mesh。

There are two ways to use it / 兩種使用方式:

- **Headless (file-based)** — the AI builds a model and writes `.stl` / `.step`
  / `.cd` files; you open them yourself. No bridge needed.
  **Headless(檔案制)**:AI 建模 → 輸出檔案,你再開檔。不需橋接。
- **Live (real-time)** — the AI edits the model in the browser tab you are
  looking at; the 3D view updates immediately. Needs the bridge + a `?live` tab.
  **Live(即時)**:AI 直接編輯你正在看的模型,3D 視圖即時更新。需橋接 + `?live` 分頁。

Both families run the **same interpreter and geometry core**, so a headless
dry-run faithfully predicts the live result.
兩條路徑跑**同一套直譯器與幾何核心**,故 headless dry-run 能忠實預測 live 結果。

---

## 1. One-time: build the server & configure the MCP client / 一次性:打包 server 並設定用戶端

```bash
npm install
npm run build -w @chili3d/mcp     # produces packages/mcp/dist/server.mjs
```

Add the server to your MCP client. For **Claude Desktop** the config file is:
把 server 加進 MCP 用戶端。**Claude Desktop** 的設定檔位置:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add one entry under `mcpServers` (use the **absolute path** to your repo):
在 `mcpServers` 內加一筆(路徑換成你 repo 的**絕對路徑**):

```json
{
  "mcpServers": {
    "chili3d": {
      "command": "node",
      "args": ["/absolute/path/to/chili3d/packages/mcp/dist/server.mjs"]
    }
  }
}
```

> Restart Claude Desktop after editing. `node` must be on your `PATH`.
> 改完**重啟 Claude Desktop**。`node` 需在 `PATH` 中。

You can now use the **headless tools** (see §5). Files are written to the system
temp directory by default; a `.cd` from `save_cd` opens in the app.
此時即可用 **headless 工具**(見 §5)。產物預設寫到系統暫存目錄;`save_cd` 的
`.cd` 可在 App 打開。

---

## 2. Live: let the AI edit the model you're viewing / 讓 AI 改你正在看的模型

Open two terminals — **start the bridge first, then the dev server**:
開兩個終端,**先起橋接、再開網頁**:

```bash
npm run bridge -w @chili3d/mcp    # terminal 1: bridge on ws://localhost:8765 (keep open)
npm run dev                       # terminal 2: dev server
```

Open **`http://localhost:8080/?live`** in the browser and leave it open. The
`?live` tab connects to the bridge (and auto-reconnects every 2 s if the bridge
starts later — no manual refresh needed).
瀏覽器開 **`http://localhost:8080/?live`** 並保持開著。`?live` 會連到橋接(橋接
晚起也會每 2 秒自動重連,不必手動重整)。

Then just talk to the AI, e.g. / 接著對 AI 說話即可,例如:

> Draw me a 30×30×30 hollow cube. / 幫我畫一個 30×30×30 的中空立方體。

The AI calls the **live tools** (`live_get_state` / `live_new_document` /
`live_run_cad_program`). The model appears in the `?live` tab in real time and
stays editable with the mouse. If no document is open, the tool reports
`hasActiveDocument:false` and the AI should ask before creating one.
AI 會呼叫 **live 工具**;模型即時出現在 `?live` 分頁,仍可用滑鼠續編。若尚未開
文件,工具回 `hasActiveDocument:false`,AI 應先問你要不要新建。

---

## 3. CAD program format / CAD program 格式

`run_cad_program` / `live_run_cad_program` take an `ops[]` array. Ops run in
order; a shape input references an earlier op's result via `{ "ref": "<id>" }`.
`ops[]` 依序執行;shape 輸入用 `{ "ref": "<前一步 id>" }` 串接。

```json
{ "ops": [
  { "op": "box",     "id": "outer", "dx": 30, "dy": 30, "dz": 30 },
  { "op": "box",     "id": "inner", "dx": 24, "dy": 24, "dz": 40, "at": { "x": 3, "y": 3, "z": 3 } },
  { "op": "boolean", "id": "hollow", "kind": "cut", "a": { "ref": "outer" }, "b": { "ref": "inner" } }
] }
```

**Units:** all lengths/coordinates are **millimetres (mm)**; angles
(`revolve` / `rotate` / `array`) are **degrees**. The interpreter does not
convert units — keep a consistent numeric scale yourself.
**單位:** 長度/座標一律 **mm**;角度(`revolve`/`rotate`/`array`)為**度**。直譯器
不換算單位,維持一致數值尺度是呼叫端的責任。

---

## 4. Supported ops / 支援的 op

| Category / 類別 | Ops |
|---|---|
| Primitives (editable) / 基本體(可參數化) | `box` · `sphere` · `cylinder` · `cone` · `pyramid` |
| Sketches / 草圖 | `rect` · `circle` · `polygon` · `line` · `arc` · `polyline` |
| Faces / 面 | `to_face` (closed wire → extrudable face) |
| Solids from sketches / 由草圖成形 | `extrude` · `revolve` · `sweep` · `pipe` · `loft` |
| Booleans / 布林 | `boolean` (`fuse` / `cut` / `common`) |
| Transforms / 變換 | `move` · `rotate` · `mirror` · `array` |
| Finishing / 後處理 | `shell` (hollow) · `fillet` · `chamfer` (by-query: all edges) |

> Primitives and `extrude` / `revolve` stay **parametric (editable)**.
> `boolean`, `shell`, `fillet`, `chamfer`, `loft` results are **baked**
> (non-parametric terminal shapes).
> 基本體與 `extrude`/`revolve` 保持**可參數化**;`boolean`/`shell`/`fillet`/
> `chamfer`/`loft` 的結果為**烤死**的終端形狀(非參數化)。

---

## 5. Tool reference / 工具速查

Headless tools write files on the server and never touch the browser. Live tools
(`live_*`) act on the model in the user's open `?live` tab. They share the same
interpreter, so build headless to **self-verify**, then push live.
Headless 工具在 server 端輸出檔案、不碰瀏覽器;live 工具(`live_*`)作用在使用者
的 `?live` 分頁。兩者共用直譯器,可先 headless **自我驗證**再推 live。

| Capability / 能力 | Headless | Live (acts on the browser) |
|---|---|---|
| Build / 建模 | `run_cad_program` | `live_run_cad_program` |
| Document / 文件 | `new_document` · `get_document_state` | `live_new_document` · `live_get_state` |
| Measure / 量測 | `get_properties` | `live_get_properties` |
| Preview / 預覽 | `render_preview` (software iso projection) | `live_render_preview` (real browser screenshot) |
| Export STL | `export_stl` | `live_export_stl` |
| Export STEP | `export_step` | `live_export_step` |
| Save `.cd` | `save_cd` | `live_save_cd` |
| Quick box / 速建方塊 | `make_box` | — |

> `get_properties` returns shape count, total volume, and bounding box — compare
> the bbox against your intended mm to verify the build before trusting it.
> Use STEP for machining / CAM / cross-CAD; STL is an approximate mesh for printing.
> `get_properties` 回形狀數、總體積、bbox —— 用 bbox 對照你預期的 mm 自驗。
> 加工/CAM/跨 CAD 用 STEP;STL 為近似網格,列印用。

---

## 6. Troubleshooting / 疑難排解

- **`... is not valid JSON`** (e.g. `Unexpected token 'e', "new documen"...`):
  MCP carries JSON-RPC over stdout, so the server must not write anything else
  to stdout. This repo routes `Logger` / Emscripten output to stderr. If it
  still happens, **rebuild (`npm run build -w @chili3d/mcp`) and restart the
  client** — it spawned the old server at launch.
  MCP 用 stdout 傳 JSON-RPC,server 不可把其他文字寫到 stdout(本 repo 已將
  `Logger`/Emscripten 導到 stderr)。若仍出現,**重新 build 並重啟用戶端**。
- **AI says success but the browser didn't update**: it used a headless tool
  (writes files only). Ask it to "edit the model I'm looking at" → it uses
  `live_run_cad_program`. Confirm the tab is `?live`.
  **AI 說成功但畫面沒更新**:它用了 headless 工具。請說「編輯我正在看的模型」並確認分頁是 `?live`。
- **Live tool returns "Live bridge unavailable"**: the bridge isn't running or
  no `?live` tab is open. Start `npm run bridge -w @chili3d/mcp`, then open/refresh
  `http://localhost:8080/?live`.
  **live 工具回「Live bridge unavailable」**:橋接沒起或沒開 `?live`。先起橋接,再開/重整 `?live`。
- **The client can't see the server**: check the absolute path in
  `claude_desktop_config.json`, that you ran `npm run build -w @chili3d/mcp`, and
  restart the client.
  **用戶端看不到 server**:確認設定檔路徑、已 build、並重啟用戶端。
