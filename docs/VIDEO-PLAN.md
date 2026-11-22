# 视频制作计划（英文主视频 + 中文字幕 + 可选中文配音）

决定：**英文旁白为主**（QDay 团队 / 国际评委 / 全部官方材料是英文），另出 `zh.srt`；
需要时用同一条时间线再生成中文配音版。目标时长 **2 分 20 秒 ± 10 秒**。

## 一、每段：画面 / 英文旁白 / 中文字幕

### seg1 — 10–14s · 浏览器 Merchant 页
**画面**：收据表停在镜头里，鼠标缓慢下移到 Tx 列。
**EN（约 28 词）**
> Every API call an agent makes has to be paid for. Today that means either a bare transfer — no
> budget, no invoice — or a balance inside one vendor's database that nobody can audit.
**ZH**：agent 每调一次 API 都要付钱。现在要么裸转账——没有额度、没有发票；要么存在厂商数据库里的预充值——谁也审计不了。

### seg2 — 22–28s · 浏览器 Open a card → MetaMask ×2
**画面**：填 `api.x402.infer` → 报价出现 → Agent address `0x87c1…` → cap `0.05` → Approve & open card → 两次确认 → 回到 Cards。
**EN（约 62 词）**
> So we give the agent a card. One merchant, one spending cap, one expiry — and revocable at any
> moment. The payer approves the cap once, the contract creates the card, and the agent can now
> spend inside it. It cannot spend one unit more.
**ZH**：所以我们给 agent 一张卡：一个商户、一个额度、一个到期时间，随时可撤销。付款人授权一次额度，合约建卡，agent 只能在卡内花钱，多一个单位都不行。

### seg3 — 40–50s · 终端 A/B：x402 闭环
**画面**：`node demo/x402/agent.mjs` 逐行输出：402 → paid tx → 200 → 超额被拒 → 伪造凭据被拒。
**EN（约 110 词）**
> Here is the loop. The API answers 402 Payment Required with a price. The agent pays from the card —
> one transaction, about a hundred thousand gas, roughly a ten-thousandth of a tQDAY. The merchant
> checks the receipt event on-chain before it serves the result, in about one hundred and eighty
> milliseconds. One block, one second. When the budget runs out, the chain refuses — you can see
> status zero — and a forged receipt gets a 402, not data.
**ZH**：这就是闭环。API 返回 402 和报价，agent 从卡里付款——一笔交易、约十万 gas、大约万分之一 tQDAY。商户先在链上核对收据事件，约 180 毫秒，一个区块一秒。预算花完，链上直接拒绝，你能看到 status 0；拿假交易哈希换不到数据。

### seg4 — 14–18s · 浏览器 Merchant 页 Refresh
**画面**：点 Refresh，收据变多；鼠标停在 Amount / Tx 上；点一下 Export CSV（出现下载即可）。
**EN（约 40 词）**
> Those rows are chain events, not our database. Every line links to the explorer, and the whole
> table exports as CSV — the reconciliation a finance team actually needs.
**ZH**：这些行是链上事件，不是我们的数据库。每一行都能点进区块浏览器，整张表可以导出 CSV——财务真正需要的对账。

### seg5 — 22–30s · 浏览器 Revoke + 终端 gasless
**画面**：Cards → 选卡 → Revoke → 徽章变 revoked；切终端跑 `node scripts/gasless-demo.mjs`，停在 `payer tx count 15 -> 15`。
**EN（约 65 词）**
> And if the agent goes wrong, the payer revokes the card — the next charge is refused. The other
> mode is gasless: the payer signs an EIP-3009 authorisation offline, the agent submits it, and the
> payer's transaction count and balance never move. Contract, transactions and receipts are all in
> the repository.
**ZH**：如果 agent 出问题，付款人撤销卡片，下一次扣款直接被拒。另一种模式免 gas：付款人离线签 EIP-3009 授权，agent 提交，付款人的交易数和余额都不变。合约、交易、收据全在仓库里。

合计英文约 **305 词**，按 150 词/分钟 ≈ **122 秒**，加上每段 0.6 秒收尾 ≈ **2 分 06 秒**，留 10 秒余量给讲解停顿。

## 二、TTS 设置

- 声音：`en-US-AriaNeural`（中性、清晰），语速 1.0；若读得太快再降到 0.95。
- 术语发音改写（写进给 TTS 的文本，不改字幕）：
  | 字幕/画面 | 给 TTS 的写法 |
  | --- | --- |
  | tUSD8 | "tee U S D eight" |
  | tQDAY | "tee Q day" |
  | EIP-3009 | "E I P thirty oh oh nine" |
  | ERC-4337 | "E R C forty three thirty seven" |
  | x402 | "x four oh two" |
- 每段一个 mp3：`video/narration/seg1.mp3 … seg5.mp3`，我用 TTS 生成后放进该目录。

## 三、字幕

- `video/out/aevumpay-demo.srt`：英文（烧进画面 + 单独提交）
- `video/out/aevumpay-demo.zh.srt`：中文（单独提交，不烧）
- 中文长句按 18 字断行（管线已实现），英文按 60 字符断行。

## 四、录制（你）

见 `docs/VIDEO.md` 的 5 段表格；关键三条：**每段头尾各停 1 秒**、**不要说话**、**不要录到 .env/私钥**。
本地预览用 `http://127.0.0.1:8123/web/`（Pages 版读不到终端那张卡）。

## 五、合成与验收（我）

```bash
node video/build.mjs            # 读 video/raw/seg1..5.mp4 + video/narration/*.mp3
```

验收清单：
- [ ] 总时长 2:05–2:35，五段齐全
- [ ] 每段旁白与画面动作对齐（抽帧核对：seg3 必须在出现 `CapExceeded` 时讲到 "the chain refuses"）
- [ ] 画面里出现 3 个 tx hash（付款成功 / status 0 / 免 gas 两行不变）
- [ ] 念出可复述数字：**9,200 metered calls per tQDAY**（seg3）
- [ ] 结尾出现仓库地址 + live 链接
- [ ] 无黑屏、无私钥、无通知弹窗
- [ ] 输出 1080p h264 + aac，带 srt

## 六、顺序

1. 你把英文旁白听一遍（我先生成 5 条 mp3 给你试听）→ 改文案（只改词，不动结构）
2. 你按 5 段录屏（不录声音）
3. 我合成第一版 → 你指出"哪句和画面对不上" → 我只调那一段的旁白长度或裁剪点，重跑
4. 定稿后出中文 srt；需要时再出中文配音版
