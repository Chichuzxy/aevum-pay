"""Build the AevumPay pitch deck (10 slides, English body, Chinese speaker notes)."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import os

W, H = Inches(13.333), Inches(7.5)
INK = RGBColor(0x0B, 0x12, 0x20)
BODY = RGBColor(0x47, 0x54, 0x67)
MUTED = RGBColor(0x98, 0xA2, 0xB3)
GREEN = RGBColor(0x07, 0x94, 0x55)
GREEN_SOFT = RGBColor(0xEC, 0xFD, 0xF3)
RED = RGBColor(0xD9, 0x2D, 0x20)
SURFACE = RGBColor(0xF7, 0xF8, 0xFA)
BORDER = RGBColor(0xE4, 0xE7, 0xEC)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
MONO = "Consolas"
SANS = "Calibri"

prs = Presentation()
prs.slide_width, prs.slide_height = W, H
BLANK = prs.slide_layouts[6]


def slide():
    s = prs.slides.add_slide(BLANK)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = WHITE
    return s


def text(s, x, y, w, h, value, size=18, color=BODY, bold=False, font=SANS,
         align=PP_ALIGN.LEFT, spacing=1.15, anchor=MSO_ANCHOR.TOP):
    box = s.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = 0
    tf.margin_top = tf.margin_bottom = 0
    for i, line in enumerate(value.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = font
    return box


def card(s, x, y, w, h, fill=SURFACE, line=BORDER, radius=0.06):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shp.adjustments[0] = radius
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = line
    shp.line.width = Pt(1)
    shp.shadow.inherit = False
    return shp


def header(s, kicker, title, sub=None):
    text(s, Inches(0.8), Inches(0.5), Inches(11.7), Inches(0.3), kicker.upper(), 12, GREEN, True, spacing=1.0)
    text(s, Inches(0.8), Inches(0.85), Inches(11.7), Inches(0.7), title, 34, INK, True, spacing=1.0)
    if sub:
        text(s, Inches(0.8), Inches(1.55), Inches(10.8), Inches(0.5), sub, 17, BODY)


def bullets(s, x, y, w, items, size=17, gap=0.42, dot=GREEN):
    for i, item in enumerate(items):
        yy = y + Inches(gap * i)
        d = s.shapes.add_shape(MSO_SHAPE.OVAL, x, yy + Inches(0.11), Inches(0.1), Inches(0.1))
        d.fill.solid()
        d.fill.fore_color.rgb = dot
        d.line.fill.background()
        text(s, x + Inches(0.22), yy, w - Inches(0.22), Inches(0.38), item, size, BODY)


def notes(s, value):
    s.notes_slide.notes_text_frame.text = value


def footer(s, n):
    text(s, Inches(0.8), Inches(6.95), Inches(8), Inches(0.3), "AevumPay · Aevum Builder Challenge #1 · Decentralized Payments", 11, MUTED)
    text(s, Inches(11.9), Inches(6.95), Inches(0.6), Inches(0.3), str(n), 11, MUTED, False, align=PP_ALIGN.RIGHT)


# ── 1 cover ────────────────────────────────────────────────────────────────
s = slide()
band = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, Inches(0.12))
band.fill.solid(); band.fill.fore_color.rgb = GREEN; band.line.fill.background()
text(s, Inches(0.9), Inches(2.0), Inches(6.2), Inches(0.4), "AEVUM BUILDER CHALLENGE #1  ·  DECENTRALIZED PAYMENTS", 13, GREEN, True)
text(s, Inches(0.9), Inches(2.5), Inches(8.5), Inches(1.2), "AevumPay", 66, INK, True, spacing=1.0)
text(s, Inches(0.9), Inches(3.55), Inches(8.2), Inches(1.0), "A budget for AI agents,\nand a receipt for every payment.", 28, BODY, False, spacing=1.2)
for i, (label, value) in enumerate(
    [("Cost per call", "1.08e-4 tQDAY"), ("Block interval", "1,000 ms"), ("Tests / receipts", "33 · 6 live")]
):
    x = Inches(0.9 + i * 4.0)
    card(s, x, Inches(5.35), Inches(3.7), Inches(1.15))
    text(s, x + Inches(0.25), Inches(5.5), Inches(3.2), Inches(0.3), label.upper(), 11, MUTED, True)
    text(s, x + Inches(0.25), Inches(5.8), Inches(3.2), Inches(0.5), value, 20, INK, True, font=MONO)
text(s, Inches(0.9), Inches(6.75), Inches(9), Inches(0.3), "QDay Aevum testnet · chain 44005 · solo builder · live demo in the repository", 12, MUTED)
notes(s, "开场：AevumPay 给 AI agent 一张有额度的卡，给商户一张无法伪造的收据。一句话交代赛道与身份，"
         "然后直接进痛点。数字先不说，留给第 6 页。")

# ── 2 problem ──────────────────────────────────────────────────────────────
s = slide()
header(s, "Problem", "Agents pay per request — and both current options fail", "Every API call, GPU second or data row an agent buys needs a settlement.")
card(s, Inches(0.8), Inches(2.3), Inches(5.7), Inches(3.25))
text(s, Inches(1.1), Inches(2.5), Inches(5.1), Inches(0.4), "Option A — a bare transfer", 20, INK, True)
bullets(s, Inches(1.1), Inches(3.05), Inches(5.0), ["No spend cap: one leaked key drains the wallet", "No invoice: support cannot reconcile", "No revoke: you cannot stop a runaway agent"], 15, 0.55, RED)
card(s, Inches(6.9), Inches(2.3), Inches(5.7), Inches(3.25))
text(s, Inches(7.2), Inches(2.5), Inches(5.1), Inches(0.4), "Option B — prepaid vendor balance", 20, INK, True)
bullets(s, Inches(7.2), Inches(3.05), Inches(5.0), ["The ledger lives in one vendor's database", "The buyer cannot audit the spend", "Money is locked before it is used"], 15, 0.55, RED)
card(s, Inches(0.8), Inches(5.95), Inches(11.8), Inches(0.75), GREEN_SOFT, RGBColor(0xAB, 0xEF, 0xC6))
text(s, Inches(1.1), Inches(6.12), Inches(11.3), Inches(0.4),
     "Card rails cannot fill the gap: Stripe charges 2.9% + $0.30 — on a $0.01 call that is 3,000% of the payment.", 16, INK, True)
footer(s, 2)
notes(s, "痛点只讲两句：裸转账没有额度没有发票，预充值锁在厂商库里没法审计。然后甩出 Stripe 那个数字："
         "2.9%+0.30 美元，对一笔 1 美分的调用等于收 30 倍。这就是为什么按次结算需要另一条轨道。")

# ── 3 product ──────────────────────────────────────────────────────────────
s = slide()
header(s, "Product", "A session card is the unit of authorisation", "One merchant, one spending cap, one expiry, revocable at any moment.")
steps = [
    ("1", "Open", "Payer approves a cap;\nthe contract creates the card", GREEN_SOFT),
    ("2", "Spend", "Agent charges per unit;\ncap, expiry and merchant are enforced", SURFACE),
    ("3", "Receipt", "Every charge emits a Charged\nevent with a receipt index", SURFACE),
]
for i, (num, title_, body, fill) in enumerate(steps):
    x = Inches(0.8 + i * 4.05)
    card(s, x, Inches(2.3), Inches(3.75), Inches(2.35), fill, BORDER)
    text(s, x + Inches(0.3), Inches(2.5), Inches(0.6), Inches(0.5), num, 30, GREEN, True, font=MONO)
    text(s, x + Inches(0.85), Inches(2.55), Inches(2.7), Inches(0.4), title_, 20, INK, True)
    text(s, x + Inches(0.3), Inches(3.25), Inches(3.2), Inches(1.2), body, 15, BODY, spacing=1.3)
    if i < 2:
        text(s, x + Inches(3.78), Inches(3.25), Inches(0.3), Inches(0.4), "→", 24, MUTED, True)
text(s, Inches(0.8), Inches(5.0), Inches(11.8), Inches(0.4), "Enforced on chain, not by a backend", 18, INK, True)
for i, (k, v) in enumerate([("Cap", "charge reverts past the limit"), ("Expiry", "block time, one day in the demo"),
                            ("Merchant", "one merchant per card"), ("Revoke", "next charge is refused")]):
    x = Inches(0.8 + i * 3.02)
    card(s, x, Inches(5.45), Inches(2.85), Inches(1.05))
    text(s, x + Inches(0.22), Inches(5.58), Inches(2.4), Inches(0.3), k.upper(), 11, MUTED, True)
    text(s, x + Inches(0.22), Inches(5.85), Inches(2.45), Inches(0.55), v, 13.5, BODY)
footer(s, 3)
notes(s, "三步讲完产品：开卡、消费、收据。重点强调「强制在链上」——额度、到期、商户绑定、撤销，"
         "都不是后端说了算。这一页是评委判断「这是不是支付原语」的地方。")

# ── 4 architecture ─────────────────────────────────────────────────────────
s = slide()
header(s, "Architecture", "Four components, one settlement path", "AevumPay v3 on QDay Aevum testnet (chain 44005, tUSD8).")
boxes = [
    (0.8, 2.45, 3.0, 1.3, "Payer", "wallet\napproves cap\nsigns EIP-3009", GREEN_SOFT),
    (4.3, 2.45, 3.3, 1.3, "AevumPay v3", "cards · metered charge\nreceipt events", WHITE),
    (8.1, 2.45, 2.5, 1.3, "Merchant", "price list\ngets paid\nreads receipts", SURFACE),
    (4.3, 4.25, 3.3, 1.3, "Session key / 4337 account", "one selector only\ncan pay, cannot transfer", SURFACE),
    (0.8, 4.25, 3.0, 1.3, "Paymaster", "sponsors gas\naccount holds 0 tQDAY", SURFACE),
    (8.1, 4.25, 2.5, 1.3, "Dashboard + SDK", "chain reads only\nno indexer, no DB", SURFACE),
]
for x, y, w, h, title_, body, fill in boxes:
    card(s, Inches(x), Inches(y), Inches(w), Inches(h), fill)
    text(s, Inches(x + 0.22), Inches(y + 0.16), Inches(w - 0.4), Inches(0.35), title_, 16, INK, True)
    text(s, Inches(x + 0.22), Inches(y + 0.55), Inches(w - 0.4), Inches(0.65), body, 12.5, BODY, spacing=1.2)
for x0, x1, y in [(3.85, 4.25, 3.05), (7.65, 8.05, 3.05)]:
    a = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x0), Inches(y), Inches(x1 - x0), Inches(0.16))
    a.fill.solid(); a.fill.fore_color.rgb = GREEN; a.line.fill.background()
a = s.shapes.add_shape(MSO_SHAPE.UP_ARROW, Inches(5.7), Inches(3.8), Inches(0.16), Inches(0.4))
a.fill.solid(); a.fill.fore_color.rgb = GREEN; a.line.fill.background()
text(s, Inches(0.8), Inches(5.85), Inches(11.8), Inches(0.8),
     "Contract 0x5378f4bb…b00149  ·  EntryPoint v0.7 0x00000000…37da032  ·  SDK aevum-pay-sdk (MIT)",
     13, MUTED, False, font=MONO)
footer(s, 4)
notes(s, "这一页只讲数据流：付款人授权 → 合约记账 → 商户收钱 → 所有人从链上读收据。"
         "强调没有后端数据库，看板和 SDK 都是直接从事件读出来的。地址和 EntryPoint 放小字，供评委核对。")

# ── 5 four settlement modes ────────────────────────────────────────────────
s = slide()
header(s, "Settlement modes", "One set of guards, four ways to pay", "The payer chooses how much trust and how much gas to hand over.")
rows = [
    ("Approve + charge", "Payer approves once", "Agent pays gas", "Autonomous agent, budget pre-approved"),
    ("EIP-3009 signature", "Payer signs offline", "Agent pays gas", "Payer holds no tQDAY, approves each call"),
    ("4337 session key", "Session key, scoped", "Agent / relayer", "Smart account, one selector only"),
    ("4337 + paymaster", "Session key + sponsor", "The paymaster", "Account holds zero gas, agent pays nothing"),
]
tbl = s.shapes.add_table(len(rows) + 1, 4, Inches(0.8), Inches(2.45), Inches(11.8), Inches(3.4)).table
for i, w in enumerate([2.9, 3.1, 2.6, 3.2]):
    tbl.columns[i].width = Inches(w)
head = ["Mode", "Who authorises", "Who pays gas", "Use it when"]
for j, h in enumerate(head):
    cell = tbl.cell(0, j)
    cell.text = h
    p = cell.text_frame.paragraphs[0]
    p.runs[0].font.size = Pt(12.5); p.runs[0].font.bold = True; p.runs[0].font.color.rgb = MUTED
    cell.fill.solid(); cell.fill.fore_color.rgb = SURFACE
for i, row in enumerate(rows, start=1):
    for j, val in enumerate(row):
        cell = tbl.cell(i, j)
        cell.text = val
        p = cell.text_frame.paragraphs[0]
        p.runs[0].font.size = Pt(13)
        p.runs[0].font.bold = j == 0
        p.runs[0].font.color.rgb = INK if j == 0 else BODY
        cell.fill.solid(); cell.fill.fore_color.rgb = WHITE
text(s, Inches(0.8), Inches(6.15), Inches(11.8), Inches(0.5),
     "Proven on chain: a session key that tries token.transfer is rejected during validation — it can only charge.", 15, GREEN, True)
footer(s, 5)
notes(s, "四种模式别逐个念，讲进化：先授权额度，再让人只签名不付 gas，再换成会话密钥，最后连 gas 都由赞助方出。"
         "收尾一句：会话密钥试图转钱会在验证阶段被拒——这就是「只能付，不能拿」。")

# ── 6 live proof ───────────────────────────────────────────────────────────
s = slide()
header(s, "Live proof", "402 → pay → verify → deliver, measured", "Everything below is a real transaction on chain 44005.")
kpis = [("Cost per call", "1.08e-4 tQDAY", "~100k gas @ 1.125 gwei"),
        ("Calls per tQDAY", "≈ 9,200", "the number to remember"),
        ("Block interval", "1,000 ms", "tx lands in 1–2 blocks"),
        ("Merchant verify", "171–190 ms", "receipt decode on chain")]
for i, (k, v, sub) in enumerate(kpis):
    x = Inches(0.8 + i * 3.02)
    card(s, x, Inches(2.35), Inches(2.85), Inches(1.5))
    text(s, x + Inches(0.22), Inches(2.5), Inches(2.5), Inches(0.3), k.upper(), 11, MUTED, True)
    text(s, x + Inches(0.22), Inches(2.8), Inches(2.55), Inches(0.45), v, 21, INK, True, font=MONO)
    text(s, x + Inches(0.22), Inches(3.35), Inches(2.55), Inches(0.35), sub, 11.5, BODY)
lines = [
    ("5 paid calls in one run", "0xe656740f… / 0x4ec7766a… / 0x9f25161d… / 0x776ebb16… / 0xd215dbb1…"),
    ("Over-budget attempt", "status 0, CapExceeded  (0x139e701c…c68bd51)"),
    ("Forged receipt", "HTTP 402 tx_not_found — the merchant does not sell"),
    ("Sponsored userOp", "status 1, account tQDAY stayed 0 (0x49213226…)"),
]
for i, (k, v) in enumerate(lines):
    y = Inches(4.15 + i * 0.62)
    text(s, Inches(0.8), y, Inches(3.2), Inches(0.35), k, 14, INK, True)
    text(s, Inches(4.1), y, Inches(8.5), Inches(0.35), v, 12.5, MUTED, False, font=MONO)
text(s, Inches(0.8), Inches(6.55), Inches(11.8), Inches(0.3),
     "Inference: local Ollama model (qwen2.5:0.5b, ~1.3 s warm); if the daemon is down the response says so.", 12, MUTED)
footer(s, 6)
notes(s, "这是唯一需要放慢的一页。念三个数字：单次 1.08e-4 tQDAY、一个 tQDAY 约 9,200 次调用、一个区块 1 秒。"
         "然后说三种失败也都在链上：超额 status 0、假收据 402、会话密钥转钱被拒。")

# ── 7 security & limits ────────────────────────────────────────────────────
s = slide()
header(s, "Security and honesty", "What is enforced, and what is not done yet", "Limits are listed next to features, not buried in an appendix.")
card(s, Inches(0.8), Inches(2.3), Inches(5.8), Inches(4.0))
text(s, Inches(1.05), Inches(2.45), Inches(5.2), Inches(0.35), "Enforced on chain", 18, GREEN, True)
bullets(s, Inches(1.05), Inches(2.95), Inches(5.2), [
    "Spend cap, expiry, merchant binding per card",
    "Instant revoke; the next charge reverts",
    "EIP-3009 nonce binds signature to card + amount",
    "Session key scoped to one selector, one target",
    "Paymaster only sponsors ops it signed",
], 14.5, 0.55)
card(s, Inches(6.9), Inches(2.3), Inches(5.7), Inches(4.0), RGBColor(0xFF, 0xFA, 0xEB), RGBColor(0xF5, 0xE0, 0xB8))
text(s, Inches(7.15), Inches(2.45), Inches(5.2), Inches(0.35), "Current limits (stated, not hidden)", 18, RGBColor(0xB5, 0x47, 0x08), True)
bullets(s, Inches(7.15), Inches(2.95), Inches(5.2), [
    "Testnet only; contracts are unaudited",
    "Merchant dedupe of receipts is in memory",
    "One merchant per card (wildcard cards exist)",
    "Dashboard has no auth or multi-tenancy",
    "Inference falls back to a stub and says so",
], 14.5, 0.55, RGBColor(0xB5, 0x47, 0x08))
text(s, Inches(0.8), Inches(6.55), Inches(11.8), Inches(0.4),
     "Evidence layers do not replace each other: tests prove logic, testnet transactions prove the flow, JSONL proves what this run measured.", 13, MUTED)
footer(s, 7)
notes(s, "这页是拿分页，不是减分页。左边念三条：额度撤销在链上、签名绑定卡片和金额、会话密钥只能调一个函数。"
         "右边主动承认：测试网、未审计、去重在内存储、看板无鉴权、推理会回退。评委吃这套。")

# ── 8 business ─────────────────────────────────────────────────────────────
s = slide()
header(s, "Business", "Who pays, and why the unit economics work", "Card rails price a $0.01 payment at 3,000% of its value; this rail prices it at 1e-4 tQDAY.")
for i, (title_, body) in enumerate([
    ("Settlement fee", "0.3–0.5% of metered volume,\npaid by the merchant"),
    ("Dashboard SaaS", "reconciliation, CSV, alerts,\nper-card revenue"),
    ("SDK / white-label", "MIT core; hosted relay,\nwebhooks and accounts as the paid tier"),
]):
    x = Inches(0.8 + i * 4.05)
    card(s, x, Inches(2.35), Inches(3.75), Inches(1.85))
    text(s, x + Inches(0.25), Inches(2.5), Inches(3.3), Inches(0.35), title_, 17, INK, True)
    text(s, x + Inches(0.25), Inches(2.95), Inches(3.3), Inches(1.1), body, 13, BODY, spacing=1.25)
text(s, Inches(0.8), Inches(4.45), Inches(11.8), Inches(0.35), "Who buys first", 17, INK, True)
for i, who in enumerate(["AI API vendors billing per request", "Agent platforms handing out keys", "GPU / compute marketplaces", "Data vendors selling per row"]):
    x = Inches(0.8 + (i % 2) * 6.0)
    y = Inches(4.9 + (i // 2) * 0.55)
    text(s, x, y, Inches(5.6), Inches(0.4), f"·  {who}", 15, BODY)
text(s, Inches(0.8), Inches(6.15), Inches(11.8), Inches(0.5),
     "At $0.01 per tQDAY a settlement costs $0.00000108 — the assumption is labelled because tQDAY has no market price yet.", 12.5, MUTED)
footer(s, 8)
notes(s, "商业模式三句话：按结算量抽 0.3–0.5%、看板做 SaaS、SDK 开源但托管和 webhook 收费。"
         "买家点名四类，最后强调单位经济学：对比 Stripe 的固定费，我们这笔基本是零。")

# ── 9 why QDay + contribution ─────────────────────────────────────────────
s = slide()
header(s, "Ecosystem fit", "Why this belongs on QDay, and what others can reuse", "Platform features used deliberately, not generically.")
left = [
    ("EIP-3009 on tUSD8", "gasless settlement; EIP-712 domain derived and asserted"),
    ("EntryPoint v0.7", "deployed on 44005; session key + paymaster live"),
    ("Shanghai EVM", "evm_version pinned; official opcode checker passes"),
    ("1,000-block log cap", "receipts read in chunks from the deploy block"),
    ("ERC-8004", "absent on 44005 — deliberately not used"),
]
for i, (k, v) in enumerate(left):
    y = Inches(2.35 + i * 0.72)
    text(s, Inches(0.8), y, Inches(3.3), Inches(0.3), k, 14, INK, True)
    text(s, Inches(4.1), y, Inches(3.0), Inches(0.5), v, 12.5, BODY)
card(s, Inches(7.4), Inches(2.3), Inches(5.2), Inches(3.6), GREEN_SOFT, RGBColor(0xAB, 0xEF, 0xC6))
text(s, Inches(7.65), Inches(2.45), Inches(4.7), Inches(0.35), "Reusable by other builders", 17, INK, True)
bullets(s, Inches(7.65), Inches(2.95), Inches(4.7), [
    "aevum-pay-sdk (MIT): cards, EIP-3009 signing, chunked logs",
    "33 Foundry tests + 5 SDK tests, CI on every push",
    "Docs: business case, runbook, recording guide",
    "One-page deployment recipe for 44005",
], 13.5, 0.75, GREEN)
text(s, Inches(0.8), Inches(6.25), Inches(11.8), Inches(0.4),
     "Roadmap: 30 days — receipt store + webhooks + sponsored gas by default; 60 days — multi-merchant accounts; 90 days — mainnet in February.", 13, MUTED)
footer(s, 9)
notes(s, "左边是「平台相关性」：EIP-3009、EntryPoint v0.7、Shanghai EVM、日志分页，还有我们主动不押 ERC-8004 的判断。"
         "右边是「生态贡献」：SDK、测试、文档、部署配方，别人能直接拿去用。")

# ── 10 close ───────────────────────────────────────────────────────────────
s = slide()
band = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, W, Inches(0.12))
band.fill.solid(); band.fill.fore_color.rgb = GREEN; band.line.fill.background()
text(s, Inches(0.9), Inches(1.6), Inches(11.5), Inches(0.4), "ONE SENTENCE TO REMEMBER", 13, GREEN, True)
text(s, Inches(0.9), Inches(2.1), Inches(11.5), Inches(1.3),
     "One metered API call settles for\n~1.08e-4 tQDAY — about 9,200 calls per tQDAY.", 34, INK, True, spacing=1.2)
for i, (k, v) in enumerate([("Live demo", "chichuzxy.github.io/\naevum-pay"), ("Repository", "github.com/Chichuzxy/\naevum-pay"),
                             ("Contract", "0x5378f4bb…\nb00149")]):
    x = Inches(0.9 + i * 4.0)
    card(s, x, Inches(3.95), Inches(3.7), Inches(1.15))
    text(s, x + Inches(0.25), Inches(4.1), Inches(3.2), Inches(0.3), k.upper(), 11, MUTED, True)
    text(s, x + Inches(0.25), Inches(4.35), Inches(3.3), Inches(0.7), v, 14, INK, True, font=MONO, spacing=1.15)
text(s, Inches(0.9), Inches(5.55), Inches(11.5), Inches(0.9),
     "Built during the challenge window on QDay Aevum testnet. Contracts are MIT, unaudited, and every claim in this deck\nlinks to a transaction hash in the repository.",
     14, BODY, spacing=1.4)
footer(s, 10)
notes(s, "收尾：把那一句可复述的数字再说一遍，然后给三个链接（live、仓库、合约）。"
         "最后一句主动说边界：挑战期间写的、测试网、未审计，每个数字都能在仓库里点到 tx。")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "AevumPay-Deck.pptx")
prs.save(out)
print("saved", out, "slides:", len(prs.slides.__iter__.__self__._sldIdLst))
