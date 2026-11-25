# 录屏操作手册（你自己先试一遍，再正式录）

总时长：**准备 10 分钟 + 试录 5 分钟 + 正式录 30–40 分钟 + 交给我 5 分钟**。
你只需要做「按顺序点开、按顺序操作、按时间停」；剪辑和字幕我来。

---

## 一、需要什么

| 东西 | 在哪 / 怎么来 |
| --- | --- |
| 录屏工具 | 用仓库自带的 `scripts/record.sh`（ffmpeg 全屏录 30fps，已验证 1920×1200） |
| 浏览器 | Chrome 或 Edge，只有这两个页面：本地预览 `http://127.0.0.1:8123/web/` 、区块浏览器（可选） |
| 三个服务 | Ollama、x402 商户、本地静态服务器（下面第 2 步） |
| MetaMask | 只有 seg2 需要点两次确认，网络已在 44005 |
| 桌面 | 干净：关掉微信/QQ/邮件/其它项目窗口，隐藏书签栏，终端字号 18–20 |

**不要出现**：`.env` 内容、私钥、`.env.demo` / `.env.x402` 文件名、其它比赛/项目窗口。

---

## 二、开始前 10 分钟（按顺序，三个终端）

**终端 A — 模型**
```bash
export PATH="$LOCALAPPDATA/Microsoft/WinGet/Links:$PATH"
ollama serve
```
看到 `Listening on 127.0.0.1:11434` 就行。第一次调用会慢（冷启动 ~44s），所以**先预热一次**：
```bash
curl -s http://127.0.0.1:11434/api/generate -d '{"model":"qwen2.5:0.5b","prompt":"hi","stream":false}' >/dev/null
```

**终端 B — 商户（每次录制前都要重新 setup，拿一张新卡）**
```bash
cd "E:\XZ\tuanduei\BSxm\Aevum Builder Challenge\aevum-pay"
node demo/x402/setup.mjs        # 看到 cardId 和 "config written"
node demo/x402/merchant.mjs     # 不要关，看到 listening on ...8402
```

**终端 C — 本地页面**
```bash
cd "E:\XZ\tuanduei\BSxm\Aevum Builder Challenge\aevum-pay"
python -m http.server 8123
```
浏览器开 `http://127.0.0.1:8123/web/#merchant`，确认：
- Cards 页能看到一张标了 **terminal demo card** 的卡
- Merchant 页有收据、数字不是 0

> 用 Pages 那个网址录不到终端卡，**必须用 127.0.0.1:8123**。

---

## 三、试录一次（5 分钟）

```bash
bash scripts/record.sh seg1 14
```
倒计时 3-2-1 后开始录，14 秒自动停。然后：
```bash
tools/ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe -v error -show_entries format=duration -of csv=p=0 video/raw/seg1.mp4
```
能读到 14.0 左右、画面里是浏览器看板，就算试录成功。**不满意就删 `video/raw/seg1.mp4` 重录**，不花钱。

---

## 四、正式录 5 段（每段独立，录坏只重录那一段）

统一规则：**开头停 1 秒、结尾停 1 秒**；鼠标移动要慢；不要缩放窗口。

### seg1 · 商户看板（14 秒）
- 窗口：浏览器最大化，停在 `#merchant`
- 操作：什么都不点，鼠标从表格上方缓慢下移到 Tx 列，停住
- 停止：14 秒到自动停（`bash scripts/record.sh seg1 14`）

### seg2 · 开卡（25 秒，唯一需要 MetaMask）
- 窗口：浏览器 `#open`
- 操作顺序（提前练一遍）：
  1. Resource 填 `api.x402.infer`，等报价出现（约 1 秒）
  2. Agent address 填 `0x87c104C83f061489a8bbd9FC9bEcadE58E52685F`
  3. Spend cap 填 `0.05`，Valid for 选 1 day
  4. 点 **Approve & open card** → MetaMask 弹窗 → 确认
  5. 第二次弹窗（createCard）→ 确认
  6. 自动跳回 Cards，看到新卡 remaining 0.05 → 停住
- 命令：`bash scripts/record.sh seg2 25`（如果还没跳回 Cards 就多录，用 `30`）

### seg3 · x402 闭环（35 秒）
- 窗口：终端 B 那张卡（`agent.mjs`），最大化，字号 18
- 操作：运行 `node demo/x402/agent.mjs`，让它自己跑到 `refused on-chain: CapExceeded` 和 `forged receipt -> HTTP 402` 为止
- 命令：`bash scripts/record.sh seg3 40`（这段最长，宁多录不少录）

### seg4 · 刷新 + 导出（14 秒）
- 窗口：浏览器 `#merchant`
- 操作：点 Refresh → 收据变多 → 鼠标停在 Amount 上 → 点 Export CSV（出现下载提示即可，别打开文件）
- 命令：`bash scripts/record.sh seg4 14`

### seg5 · 撤销 + 免 gas（24 秒）
- 窗口：先浏览器 `#cards`，点一张卡 → 点 **Revoke card** → MetaMask 确认 → 徽章变 revoked
- 然后把终端 C 切到前面，运行 `node scripts/gasless-demo.mjs`，停在那两行 `payer tx count … -> …` / `payer tQDAY … -> …`
- 命令：`bash scripts/record.sh seg5 24`（不够就 30）

---

## 五、录完自检（2 分钟）

```bash
for f in video/raw/seg*.mp4; do
  printf "%s " "$f"; tools/ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe -v error -show_entries format=duration -of csv=p=0 "$f"
done
```
对照：seg1 ≈14、seg2 ≈25、seg3 ≈40、seg4 ≈14、seg5 ≈24（多几秒没关系，我会裁到旁白长度）。
再快速回放每一段，确认：没有黑屏、没有弹窗、没有 `.env`、鼠标没有停在按钮上乱抖。

---

## 六、交给我

5 个文件放在 `video/raw/` 就行，然后跟我说一声「录完了」。我执行：
```bash
node video/build.mjs
```
产出 `video/out/aevumpay-demo.mp4`（含片头片尾、英文旁白、英中双字幕）。
我会抽帧核对 5 个点：seg3 讲到 "the chain refuses" 时画面必须是 `CapExceeded`、seg5 讲到 "never move" 时必须是那两行不变的数字。

---

## 七、预算与时间

- 每次 `setup.mjs` 开一张 0.05 tUSD8 的卡；一次完整录制（5 次调用打满）约花 **0.05 tUSD8**，你还有 54+
- 时间：准备 10 分钟、试录 5 分钟、正式录 30–40 分钟（含重录 1–2 次）、我合成 5 分钟

**现在就可以开始**：先跑第 2 步的三个终端，再试录 seg1。
