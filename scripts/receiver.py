#!/usr/bin/env python3
"""Notion の Send webhook を受けて claude -p を起動する最小の受け口（Plan B 用）。

  WEBHOOK_SECRET=... python scripts/receiver.py --port 8787

Notion 側は Send webhook のカスタムヘッダに X-Webhook-Secret: <WEBHOOK_SECRET> を付ける。
受け取ったら即 202 を返し、処理はバックグラウンドで 1 本ずつ直列に流す。
（ROUTINE_PROMPT.md が「完了かつ未処理」を自分で探すので、payload の中身は使わない）
"""
import argparse
import os
import queue
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPT = (ROOT / "ROUTINE_PROMPT.md").read_text(encoding="utf-8")
SECRET = os.environ.get("WEBHOOK_SECRET", "")
jobs: "queue.Queue[str]" = queue.Queue()


def worker() -> None:
    while True:
        reason = jobs.get()
        cmd = [
            "claude", "-p", PROMPT,
            "--allowedTools", "Read,Write,Edit,Bash,mcp__notion__*,mcp__slack__*",
            "--output-format", "text",
        ]
        print(f"[run] {reason}", flush=True)
        try:
            subprocess.run(cmd, cwd=ROOT, check=False, timeout=60 * 30)
        except subprocess.TimeoutExpired:
            print("[run] timeout", file=sys.stderr, flush=True)
        jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if SECRET and self.headers.get("X-Webhook-Secret") != SECRET:
            self.send_response(401)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)  # 読み捨て。中身は使わない
        # 実行待ちが既にあれば積まない（1 回の実行で未処理を全部さらうため）
        if jobs.qsize() == 0:
            jobs.put("notion webhook")
        self.send_response(202)
        self.end_headers()

    def log_message(self, fmt, *args):  # noqa: D102
        print(f"[http] {fmt % args}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()
    if not SECRET:
        print("WEBHOOK_SECRET が未設定です。認証なしで受け付けます", file=sys.stderr)
    threading.Thread(target=worker, daemon=True).start()
    HTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
