# 练习手册（录视频前自己跑几遍）

每个命令都是可重复的。跑一次大约花 0.05 tUSD8（卡额度）+ 可忽略的 tQDAY，当前钱包还有 ~49 tUSD8，
够跑十几次。**用完记得别在正式录制时清空预算**——想留余地就把 cap 调小（见第 4 节）。

## 0. 环境自检（30 秒）

```bash
cd "E:\XZ\tuanduei\BSxm\Aevum Builder Challenge\aevum-pay"
node -e "const fs=require('fs');['.env','.env.demo','.env.x402'].forEach(f=>console.log(f, fs.existsSync(f)?'ok':'MISSING'))"
```
三个都要 ok。缺了就：`.env` 填 PRIVATE_KEY；`.env.demo` / `.env.x402` 用 `cast wallet new` 生成后各贴一行。

## 1. 主流程（视频里最常录）：x402 闭环

```bash
node demo/x402/setup.mjs          # 每次都会开一张新卡
node demo/x402/merchant.mjs       # 终端 1，看到 "listening on ...8402"
node demo/x402/agent.mjs          # 终端 2
```

**你应该看到的**：每轮 `402 → paid tx → 200`，最后 `refused on-chain: CapExceeded` 和
`forged receipt -> HTTP 402 tx_not_found`。**录屏要点**：`paid tx … block … (+1000ms)` 这一行，
口播“一次结算不到 0.1 秒gas、1 秒一个区块”。

## 2. 免 gas 实证（讲“payer 零 gas”用）

```bash
node scripts/gasless-demo.mjs
```
**看点**：`payer tx count : N -> N`、`payer tQDAY : X -> X` 两行都不变。这是最容易被评委追问的点，
一定要在录屏里停 2 秒。

## 3. 4337 会话密钥（讲“agent 不能乱花钱”用）

```bash
forge build
node scripts/4337-demo.mjs        # 每次部署一个新账户，约 0.7e-3 tQDAY
```
**看点**：`handleOps(charge) status=success` 之后紧跟 `handleOps(token.transfer) status=reverted`。
两行对比就是“同一个 agent 钥匙，只能付款，不能转走钱”。

## 4. 想省预算 / 想改额度

```bash
X402_CAP=0.02 X402_PRICE=0.01 node demo/x402/setup.mjs   # 卡额度 0.02，只够 2 次
```

## 5. 视频录之前最后一遍检查

- [ ] 浏览器打开 https://chichuzxy.github.io/aevum-pay/ ，Merchant 页有收据、数字在涨
- [ ] 终端字号调到 18–20，关闭无关窗口（别露出 `.env` 内容）
- [ ] `demo/x402/agent.mjs` 跑完再录，避免 VPN 抖动影响画面
- [ ] 每条 tx 的区块浏览器链接能打开（`explorer-test.qday.info/tx/...`）

## 6. 常见小故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `EADDRINUSE 8402` | 上一个 merchant 还在跑 | 关掉那个终端，或 `PORT=8403 node demo/x402/merchant.mjs` |
| `wrong_card` | merchant 用的 config 跟当前卡不匹配 | 重启 merchant（setup 每次换卡） |
| `insufficient funds` | agent 的 tQDAY 用完了 | `cast send --value 0.02ether` 从主钱包补一点 |
| `AA23 reverted` | 账户合约 nonce 类型写错（已修复） | 拉最新代码重新 `forge build` |

## 7. 真实推理（本地 Ollama）

merchant 默认调用 `http://127.0.0.1:11434` 的 `qwen2.5:0.5b`；没有 daemon 时自动回退 stub 并在响应里写明。

```bash
# 便携版已装在 WinGet Links，先起服务（另开一个终端）
ollama serve
ollama pull qwen2.5:0.5b      # 约 400MB，直连即可，不必开 VPN
# 换模型/地址
OLLAMA_MODEL=llama3.2:1b OLLAMA_URL=http://127.0.0.1:11434 node demo/x402/merchant.mjs
```

**录制时**：Merchant 页/终端里看到 `[qwen2.5:0.5b / ollama]` 才是真模型；如果出现 `aevum-stub-1 / stub`，
说明 daemon 没起，先别录，否则会被评委问穿。
