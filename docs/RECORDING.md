# 录制分镜（采用「终端付款 + 浏览器看板」方案）

原则：**镜头里不出现私钥、不切 MetaMask 账户、不粘贴 agent key**。付款是 agent 在后台做的事，
所以它只出现在终端；浏览器只负责「人」能看懂的部分：开卡、额度、撤销、对账。

## 开录前的窗口摆位

| 窗口 | 内容 | 位置 |
| --- | --- | --- |
| 终端 A | `node demo/x402/merchant.mjs`（一直开着，显示 listening） | 屏幕左 |
| 终端 B | `node demo/x402/agent.mjs`（录的时候才跑） | 屏幕右 |
| 浏览器 | https://chichuzxy.github.io/aevum-pay/ ，先停在 Merchant 页 | 全屏或左 2/3 |
| 可选终端 C | `node scripts/gasless-demo.mjs` | 需要讲免 gas 时切 |

字体 18–20，终端主题深色，浏览器缩放 100%。关掉其它标签页。

## 分镜（总计约 2 分 30 秒）

**① 0:00–0:20 痛点（浏览器 Merchant 页，不要动）**
口播：「agent 每次调 API 都要付钱，但现在只有两种做法：裸转账（没法限额、没有发票），
或者预充值在厂商数据库里（不可验证）。卡组织更不行——Stripe 一笔固定费 0.30 美元，
一次 0.01 美元的 API 调用要付 30 倍手续费。」
画面：Merchant 页已有几张收据，数字 0.20 tUSD8。

**② 0:20–0:55 开卡（浏览器 → Open a card）**
操作：Resource 填 `api.x402.infer` → 等报价出现 → Agent address 填 `0x87c104C83f061489a8bbd9FC9bEcadE58E52685F`
→ Spend cap `0.05` → 1 day → 点 Approve & open card → MetaMask 弹两次（approve、createCard）→ 确认。
口播：「我给 agent 一张卡：只能给这个商户付、最多 0.05、一天后失效，随时能撤。」
画面：跳回 Cards，出现新卡，remaining 0.05。

**③ 0:55–1:40 付款（终端 B：`node demo/x402/agent.mjs`）**
画面逐行出现：
```
402  0.01 tUSD8/unit · 12ms
paid tx 0x… gas 90944 · block 3341xxx (+1000ms) · wall 1.4s
200  receipt #21 · verify 183ms · total 1.9s
```
口播（只讲三句，别念代码）：「门卫先要钱（402），agent 从卡里付款，商户在链上核对了收据才发货。
一次结算 0.0001 tQDAY，一个区块 1 秒，1 个 tQDAY 够付 9,200 次调用。」
等到它自然跑到：
```
refused on-chain: CapExceeded
reverted tx 0x… (status 0)
forged receipt -> HTTP 402 tx_not_found
```
口播：「预算花完，链上直接拒绝；拿假 tx 也换不到货。」

**④ 1:40–2:05 对账（浏览器 Merchant 页 → Refresh）**
操作：点 Refresh，收据表多出刚才几行；鼠标停在 Amount 和 Tx 上。
口播：「这些不是我编的数字，是链上事件；点 tx 就是区块浏览器。导出 CSV 就能进财务系统。」
若时间够，点 Export CSV（出现下载提示即可，别等打开文件）。

**⑤ 2:05–2:30 撤销 + 免 gas（浏览器 Cards → 选卡 → Revoke；然后切终端 C 跑 gasless）**
操作：Cards 里点一张卡 → Revoke card → MetaMask 确认 → 徽章变 revoked。
口播：「发现不对，一键撤销，下一次付款直接被拒。」
切终端 C 跑 `node scripts/gasless-demo.mjs`，指着两行：
`payer tx count : 15 -> 15`、`payer tQDAY : 5.89… -> 5.89…`
口播：「另一种模式：付款人只签名，不付 gas——交易数是 0，余额没变。」
收尾一句：「合约地址、部署交易、每一笔付款都在 README 里，仓库 MIT。」

## 两个注意

1. **浏览器里开的卡，和终端 x402 脚本用的卡不是同一张**（脚本用 `setup.mjs` 生成的卡）。
   所以顺序要按上面来：先看板 → 再开卡/撤销 → 终端付款穿插。不要在同一段里说“这张卡就是终端那张”。
   如果希望浏览器里直接看到终端那张卡，跟我说一声，我给页面加个本地读取 `demo/x402/config.json` 的小功能（10 行）。
2. 录制时如果 VPN 抖动，`wall` 那一列会变大——**只口播 `block (+1000ms)` 和 `verify ~180ms`**，
   墙钟时间不要说，避免被追问“为什么 10 秒”。

## 录完立刻做

- [ ] 视频里至少出现 3 个 tx hash（付款成功、status 0 拒绝、免 gas）
- [ ] 念出 1 个可复述数字：**1 tQDAY ≈ 9,200 次计量调用**
- [ ] 结尾出现仓库地址和 live 链接
- [ ] 存一份原始录屏（未剪辑），再导出一版 1080p
