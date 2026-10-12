"""Finance Lab 本地演示服务：静态站点 + 银行真链路 /api 白名单代理。

用法：
    python serve.py                 # 127.0.0.1:8766，不自动开浏览器
    python serve.py --open          # 启动后打开浏览器
    python serve.py --port 9000     # 指定端口

结构：
  · 静态页面直接从本目录提供（landing / workspace / investment / merchant / catalog）
  · /api/* 中属于团队银行后端的路由转发到 http://127.0.0.1:8765
  · 白名单之外的 /api/*（店主/理财演示 harness 接口）返回 404 API_NOT_FOUND，
    前端 api.js 会自动回退到浏览器内置演示数据
  · 团队后端不可达时返回 503 BACKEND_UNAVAILABLE，前端同样回退演示模式并明确标注
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
BACKEND = "http://127.0.0.1:8765"
DEFAULT_PORT = 8766
PROXY_TIMEOUT = 8

# 团队银行后端（web/app.py）的白名单路由：只有这些接口会转发到真后端。
BACKEND_PATHS = {
    "/api/scenarios/boot",
    "/api/scenarios/run",
    "/api/scenarios/confirm",
    "/api/scenarios/cancel",
    "/api/scenarios/pending",
    "/api/audit",
    "/api/bootstrap",
    "/api/approvals",
    "/api/memory",
    "/api/trades",
    "/api/brief",
    "/api/review",
    "/api/decide",
    "/api/breaker/reset",
    "/api/reset",
}

# 团队前端对比版/证据板页面：整段前缀转发给后端（含其 /static 资源）
BACKEND_PREFIXES = (
    "/compare",
    "/evidence",
    "/static/compare",
    "/static/evidence",
)

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

NO_CACHE = "no-store, must-revalidate"


class Handler(BaseHTTPRequestHandler):
    server_version = "FinanceLab/1.0"

    def log_message(self, fmt, *args):  # noqa: A003
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---- 静态文件 ----
    def _static(self, rel: str) -> None:
        if rel in ("", "/"):
            rel = "landing.html"
        target = (ROOT / rel.lstrip("/")).resolve()
        if not str(target).startswith(str(ROOT)) or not target.is_file():
            self._json(404, {"error": {"code": "NOT_FOUND", "message": "not found"}})
            return
        body = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Cache-Control", NO_CACHE)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- 后端代理 ----
    def _proxy(self, method: str, path: str) -> None:
        url = BACKEND + path
        data = None
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            data = self.rfile.read(length) if length else b""
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json; charset=utf-8")
        try:
            with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type",
                                 resp.headers.get("Content-Type", "application/json") + "; charset=utf-8")
                self.send_header("Cache-Control", NO_CACHE)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self._json(503, {"error": {"code": "BACKEND_UNAVAILABLE",
                                       "message": "团队后端未启动（127.0.0.1:8765）。"}})

    # ---- 通用 ----
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", NO_CACHE)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            if path in BACKEND_PATHS:
                return self._proxy("GET", self.path)
            return self._json(404, {"error": {"code": "API_NOT_FOUND", "message": "route not found"}})
        if any(path == p or path.startswith(p + "/") for p in BACKEND_PREFIXES):
            return self._proxy("GET", self.path)
        self._static(path)

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            if path in BACKEND_PATHS:
                return self._proxy("POST", self.path)
            return self._json(404, {"error": {"code": "API_NOT_FOUND", "message": "route not found"}})
        self._json(405, {"error": {"code": "METHOD_NOT_ALLOWED", "message": "post not supported"}})


def main(argv: list[str] | None = None) -> int:
    global BACKEND  # noqa: PLW0603
    parser = argparse.ArgumentParser(description="Finance Lab 本地演示服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--backend", default=BACKEND, help="团队银行后端地址")
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = parser.parse_args(argv)

    BACKEND = args.backend

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        print(f"端口 {args.port} 被占用或不可用：{exc}")
        return 1

    url = f"http://{args.host}:{args.port}/"
    print(f"Finance Lab 演示站已启动：{url}")
    print(f"银行真链路代理 → {BACKEND}（白名单 /api 路由；未启动时前端回退演示模式）")
    print("按 Ctrl+C 停止。")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
