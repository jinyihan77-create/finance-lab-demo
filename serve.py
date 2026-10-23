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
import os
import sys
import secrets
import re
from http.cookies import SimpleCookie
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# pythonw 无窗口模式下 stdout 为 None，print 会崩溃——写入黑洞保持兼容
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

ROOT = Path(__file__).resolve().parent
BACKEND = "http://127.0.0.1:8765"
RISK_UPSTREAM = "https://fund-risk-workbench.panxintian44.chatgpt.site"
DEFAULT_PORT = 8766
PROXY_TIMEOUT = 12

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

# 在线风控工作台（公网部署）：整段前缀转发，同源内嵌进工作台「风控」标签页。
# 注意顺序：/api/safety、/api/paper-trade 必须先于 /api 白名单判定。
RISK_PREFIXES = (
    "/risk",
    "/investment",
    "/api/safety",
    "/api/paper-trade",
)

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
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
            rel = "workspace.html"
        target = (ROOT / rel.lstrip("/")).resolve()
        if (not target.is_relative_to(ROOT) or not target.is_file()
                or any(part.startswith('.') for part in target.relative_to(ROOT).parts)
                or target.suffix.lower() not in ('.html','.css','.js','.mjs','.svg','.png','.jpg','.jpeg','.ico','.json','.woff2')):
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
    def _proxy(self, method: str, path: str, base: str | None = None) -> None:
        base = base or BACKEND
        url = base + path
        data = None
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            data = self.rfile.read(length) if length else b""
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json; charset=utf-8")
        # 风控工作台在 Cloudflare 后面：需要浏览器级请求头，否则 1010 拦截
        req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        req.add_header("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
        req.add_header("Accept-Language", "zh-CN,zh;q=0.9")
        # 转发调用方自定义头（如风控工作台的 X-Risk-Csrf）
        for name, value in self.headers.items():
            if base == RISK_UPSTREAM and name.lower() in ("origin", "referer"):
                continue  # 上游按自身 Origin 校验 CSRF，代理同源后必须丢弃
            if name.lower() in ("x-risk-csrf", "authorization", "x-requested-with"):
                req.add_header(name, value)
            # 风控工作台的 CSRF 与 risk_session cookie 绑定，需双向转发 cookie
            if base == RISK_UPSTREAM and name.lower() == "cookie":
                req.add_header("Cookie", value)
        try:
            with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type",
                                 resp.headers.get("Content-Type", "application/json") + "; charset=utf-8")
                self.send_header("Cache-Control", NO_CACHE)
                if base == RISK_UPSTREAM:
                    for cookie in resp.headers.get_all("Set-Cookie") or []:
                        self.send_header("Set-Cookie", cookie)
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
                                       "message": "上游服务不可达（团队后端或在线风控工作台）。"}})

    # ---- 通用 ----
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", NO_CACHE)
        if getattr(self, "assistant_cookie", None):
            self.send_header("Set-Cookie", self.assistant_cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _assistant(self, method, path):
        # Private local persistence is served only to loopback clients.
        if self.client_address[0] not in ('127.0.0.1','::1'):
            return self._json(403, {'error':{'message':'本地对话服务仅允许本机访问。'}})
        if urlparse('http://'+self.headers.get('Host','')).hostname not in ('127.0.0.1','localhost','::1'):
            return self._json(403, {'error':{'message':'请通过本机地址打开工作空间。'}})
        origin=self.headers.get('Origin')
        if origin and origin != 'http://'+self.headers.get('Host',''):
            return self._json(403, {'error':{'message':'请求来源不匹配。'}})
        cookie=SimpleCookie()
        try:cookie.load(self.headers.get('Cookie',''))
        except Exception:pass
        value=cookie.get('finance_session')
        session=value.value if value and re.fullmatch(r'[a-f0-9]{64}',value.value) else secrets.token_hex(32)
        self.assistant_cookie='finance_session='+session+'; HttpOnly; SameSite=Strict; Path=/api/assistant; Max-Age=31536000'
        service=self.server.assistant
        try:
            if method=='GET' and path=='/api/assistant/state':
                return self._json(200,{'state':service.state(session)})
            if method=='GET' and path=='/api/assistant/export':
                scope=parse_qs(urlparse(self.path).query).get('scope',['all'])[0]
                body=service.export(session,scope)
                self.send_response(200)
                self.send_header('Content-Type','text/csv; charset=utf-8')
                self.send_header('Content-Disposition','attachment; filename="finance-journal.csv"')
                self.send_header('Cache-Control','no-store')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers();self.wfile.write(body);return
            if method=='POST' and path in ('/api/assistant/message','/api/assistant/record'):
                if self.headers.get('X-Finance-Request')!='1' or not self.headers.get('Content-Type','').startswith('application/json'):
                    return self._json(403,{'error':{'message':'请求格式不正确。'}})
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536:return self._json(413,{'error':{'message':'这段内容太长，请分段发送。'}})
                body=json.loads(self.rfile.read(length))
                if not isinstance(body,dict):raise ValueError('请求内容必须为对象。')
                result=service.message(session,body) if path.endswith('/message') else service.change(session,body)
                return self._json(200,result)
            return self._json(404,{'error':{'message':'没有找到该服务。'}})
        except (ValueError,TypeError) as exc:
            return self._json(400,{'error':{'message':str(exc)}})
        except Exception:
            return self._json(500,{'error':{'message':'保存暂时失败，草稿已保留。请稍后重试。'}})

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith('/api/assistant/'):
            return self._assistant('GET',path)
        if any(path == p or path.startswith(p + "/") for p in RISK_PREFIXES):
            return self._proxy("GET", self.path, base=RISK_UPSTREAM)
        if path.startswith("/api/"):
            if path in BACKEND_PATHS:
                return self._proxy("GET", self.path)
            return self._json(404, {"error": {"code": "API_NOT_FOUND", "message": "route not found"}})
        if any(path == p or path.startswith(p + "/") for p in BACKEND_PREFIXES):
            return self._proxy("GET", self.path)
        self._static(path)

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith('/api/assistant/'):
            return self._assistant('POST',path)
        if any(path == p or path.startswith(p + "/") for p in RISK_PREFIXES):
            return self._proxy("POST", self.path, base=RISK_UPSTREAM)
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
    parser.add_argument("--assistant-db", default=str(ROOT / 'data' / 'assistant.sqlite'), help="本地私有会话数据库")
    args = parser.parse_args(argv)

    BACKEND = args.backend
    from assistant.storage import Store
    from assistant.service import Assistant

    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
        server.assistant = Assistant(Store(args.assistant_db))
    except OSError as exc:
        print(f"端口 {args.port} 被占用或不可用：{exc}")
        return 1

    url = f"http://{args.host}:{args.port}/"
    print(f"Finance Lab 演示站已启动：{url}")
    print("对话入口：本机持久化收支与会话；投资分析连接团队模型，失败明确提示。")
    print(f"旧任务台后端 → {BACKEND}（仅旧页面包含演示回退）")
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
