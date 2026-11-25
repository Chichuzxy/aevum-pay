#!/usr/bin/env python
"""Generate the English narration mp3s (video/narration/segN.mp3) from video/narration.json.

    pip install edge-tts
    python video/tts.py            # all segments
    python video/tts.py 3          # only segment 3

Voice defaults to en-US-AriaNeural; override with VOICE=... and RATE=+0% .
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "narration"
OUT.mkdir(exist_ok=True)


async def synth(text: str, path: Path, voice: str, rate: str) -> None:
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(str(path))


async def main() -> None:
    data = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))
    voice = os.environ.get("VOICE", data.get("voice", "en-US-AriaNeural"))
    rate = os.environ.get("RATE", "+0%")
    only = int(sys.argv[1]) if len(sys.argv) > 1 else None
    for seg in data["segments"]:
        if only and seg["seg"] != only:
            continue
        path = OUT / f"seg{seg['seg']}.mp3"
        await synth(seg["en"], path, voice, rate)
        print(f"seg{seg['seg']}: {path.name} ({path.stat().st_size // 1024} kB) [{voice} {rate}]")

    for name in ("intro", "outro"):
        block = data.get(name)
        if not block or only:
            continue
        path = OUT / f"{name}.mp3"
        await synth(block["en"], path, voice, rate)
        print(f"{name}: {path.name} ({path.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    asyncio.run(main())
