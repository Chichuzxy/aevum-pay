# evidence/

机器生成，不要手改。每次跑 demo 会新增一个 `x402-<时间戳>.jsonl`，一行一个事件。

## 证据层级（不能互相替代）

| 层级 | 本次是什么 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| 本次真实链上执行 | JSONL 里的 `paid_call` 行：tx hash + block + gas + receiptIndex | 这一笔确实在 QDay 44005 上结算了，商户账户到账 | 不能证明"生产可用"或"模型推理是真的" |
| 本次链上失败用例 | `over_cap` 行的 tx（status 0，revert `CapExceeded`） | 额度上限由合约执行，不是后端假装拦 | 不能证明商户永远不会超卖（那是服务端逻辑） |
| 本次服务端拒绝 | `forged_receipt` 行（HTTP 402 `tx_not_found`） | 拿假 tx hash 换不到服务 | 不能证明付费重放防护完备（仅 in-memory 去重 + 链上 nonce） |
| 历史参考 | 02_链上记录 里的早期部署与 demo tx | 项目脉络 | **不属于**本次 x402 演示，不混用 |

## 复现

```bash
node demo/x402/setup.mjs      # 生成 config.json（三角色、开卡）
node demo/x402/merchant.mjs   # 终端 1
node demo/x402/agent.mjs      # 终端 2，写入本目录
```

## 一个坑，写在这里免得下次再查

QDay 的 RPC 会断开空闲 TLS（实测空闲 >5s 后再请求要重新握手 ~5.3s）。所以两个 demo 进程都跑了 2s keep-alive ping；
README 里的延迟数字一律用**区块数据**（block interval / tx 所在区块），不用本机墙钟，墙钟另列并标注含 VPN。
