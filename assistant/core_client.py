"""统一后端（Core Agent）客户端。

团队后端跑在 Cloudflare Worker ``personal-ai-fund-manager-core-agent`` 上，
契约是 ``model-review.v1``。这里只做三件事：

1. 把本仓库的口语问题包装成 Core Agent 的请求；
2. 真实转发，并把 HTTP 状态原样带回来；
3. 把返回的 workflow 记录映射成本项目 UI 已消费的字段。

明确不做：
- 不在失败时退回规则引擎（真实模型联调模式必须显示失败）；
- 不生成审批或执行授权，``execution_allowed`` 永远是后端给的值；
- 不缓存、不重试到成功。

环境变量：
    CORE_AGENT_BASE_URL   默认 https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev
    CORE_AGENT_API_KEY    可选；后端未配置密钥时可不填
    CORE_AGENT_TIMEOUT    默认 60 秒（后端建议客户端最多等 60 秒）
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid
from typing import Any

DEFAULT_BASE_URL = (
    "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev"
)
REVIEW_VERSION = "model-review.v1"
PROXY_ENV_HINT = "CORE_AGENT_PROXY"
# Cloudflare 会拦截空 UA 的自动化请求（403），显式声明客户端身份。
USER_AGENT = "finance-lab-core-agent-client/1.0 (+local demo)"


class CoreAgentError(RuntimeError):
    """统一后端调用失败；携带 HTTP 状态与后端错误体。"""

    def __init__(self, message: str, status_code: int = 0, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def base_url() -> str:
    return (os.environ.get("CORE_AGENT_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _timeout() -> float:
    try:
        return max(5.0, float(os.environ.get("CORE_AGENT_TIMEOUT") or 60))
    except ValueError:
        return 60.0


def _transport() -> urllib.request.OpenerDirector:
    """按需走代理。

    只读取显式配置的 ``CORE_AGENT_PROXY``，不自动继承系统代理：
    演示机常开全局代理，静默继承会让"本地能通、评委机器不通"这类问题被掩盖。
    """
    proxy = (os.environ.get(PROXY_ENV_HINT) or "").strip()
    if proxy:
        return urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def build_request(question: str, *, kind: str = "combined",
                  scenario: str = "GENERAL_REVIEW",
                  data_mode: str = "SYNTHETIC_REPLAY",
                  idempotency_key: str | None = None) -> dict[str, Any]:
    text = (question or "").strip()
    if not text:
        raise ValueError("问题不能为空")
    return {
        "schema_version": REVIEW_VERSION,
        "kind": kind,
        "scenario": scenario,
        "text": text[:6000],
        "data_mode": data_mode,
        "execution_mode": "PAPER",
        "capability": "REVIEW_ONLY",
        "output_formats": ["json"],
        "idempotency_key": idempotency_key or f"idem-{uuid.uuid4().hex[:20]}",
    }


def post_review(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """POST /api/review，原样返回 (HTTP 状态, JSON 体)。"""
    url = base_url() + "/api/review"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    api_key = (os.environ.get("CORE_AGENT_API_KEY") or "").strip()
    if api_key:
        headers["X-Core-Agent-Key"] = api_key
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with _transport().open(request, timeout=_timeout()) as response:
            status = response.status
            raw = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise CoreAgentError(f"统一后端不可达：{exc}", 0) from exc

    try:
        data = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CoreAgentError("统一后端返回的不是合法 JSON", status, raw[:400]) from exc
    if not isinstance(data, dict):
        raise CoreAgentError("统一后端返回结构异常", status, data)
    return status, data


def _first(source: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return value
    return default


def _model_summary(record: dict[str, Any]) -> dict[str, Any]:
    model = record.get("model") if isinstance(record.get("model"), dict) else {}
    response = model.get("model_response") if isinstance(model.get("model_response"), dict) else {}
    return {
        "provider": model.get("provider") or response.get("provider"),
        "name": _first(model, "model_name", "name", default=response.get("model")),
        "source": model.get("source"),
        "call_succeeded": bool(response.get("call_succeeded")),
        "attempt_count": response.get("attempt_count"),
        "retry_count": response.get("retry_count"),
        "raw_text": response.get("raw_text"),
    }


def to_ui_response(status: int, record: dict[str, Any]) -> dict[str, Any]:
    """把 Core Agent 的 workflow 记录映射成本项目前端已消费的形状。

    ``execution_state`` 只由后端状态推导，UI 不得自行放宽：
    PENDING_RISK → awaiting_risk，其余非成功状态一律保留原状态名。
    """
    workflow_status = _first(record, "status", default="UNKNOWN")
    handoff = record.get("risk_handoff") if isinstance(record.get("risk_handoff"), dict) else {}
    approval = record.get("approval") if isinstance(record.get("approval"), dict) else {}
    proposed = record.get("proposed_action")
    if isinstance(proposed, dict) and "proposed_action" in proposed:
        proposal = proposed
    else:
        proposal = {"proposed_action": proposed, "action_reason": None}

    execution_state = {
        "PENDING_RISK": "awaiting_risk",
        "PENDING_APPROVAL": "awaiting_approval",
        "APPROVED": "approved_not_executed",
        "CANCELLED": "cancelled",
        "FAILED": "failed",
        "EXPIRED": "expired",
    }.get(str(workflow_status), str(workflow_status).lower())

    model = _model_summary(record)
    # 模型没成功就不展示提议：可能来自规则或异常路径，冒充模型结论会误导评审。
    recommendation = None
    if model["call_succeeded"]:
        recommendation = {
            "action": proposal.get("proposed_action"),
            "reason": proposal.get("action_reason"),
            "risk_level": proposal.get("risk_level"),
            "requested_action": proposal.get("requested_action"),
            "parameters": proposal.get("action_parameters") or {},
            "proposal_sha256": proposal.get("proposal_sha256"),
        }

    return {
        "engine": "core-agent",
        "backend": {
            "base_url": base_url(),
            "http_status": status,
            "contract_version": _first(record, "schema_version", "workflow_version"),
        },
        "run_id": record.get("run_id"),
        "task_id": record.get("task_id"),
        "session_id": record.get("session_id"),
        "audit_id": (record.get("audit") or {}).get("audit_id") if isinstance(record.get("audit"), dict) else None,
        "workflow_status": workflow_status,
        "execution_state": execution_state,
        "execution_allowed": bool(handoff.get("execution_allowed", False)),
        "decision_source": "model" if model["call_succeeded"] else "none",
        "model_status": "live" if model["call_succeeded"] else "unavailable",
        "model": model,
        "recommendation": recommendation,
        "approval": approval,
        "risk_decision": record.get("risk_decision"),
        "risk_handoff": {
            "handoff_id": handoff.get("handoff_id"),
            "decision": handoff.get("decision"),
            "execution_allowed": handoff.get("execution_allowed"),
            "status": handoff.get("status"),
        },
        "reviewed_input": record.get("reviewed_input"),
        "audit": record.get("audit"),
        "raw": record,
    }


def review(question: str, **kwargs: Any) -> dict[str, Any]:
    """完整链路：包装 → 真实调用 → 映射。失败抛 CoreAgentError，绝不回退。"""
    payload = build_request(question, **kwargs)
    status, data = post_review(payload)
    if status >= 400 or data.get("error"):
        raise CoreAgentError(
            f"统一后端返回 {status}：" + json.dumps(
                data.get("error") or data, ensure_ascii=False
            )[:400],
            status,
            data,
        )
    return to_ui_response(status, data)


def _get(path: str) -> tuple[int, dict[str, Any]]:
    request = urllib.request.Request(
        base_url() + path,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    try:
        with _transport().open(request, timeout=min(_timeout(), 15.0)) as response:
            status = response.status
            raw = response.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise CoreAgentError(f"统一后端不可达：{exc}", 0) from exc
    try:
        data = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        data = {}
    return status, data if isinstance(data, dict) else {}


def status() -> dict[str, Any]:
    """只读探活：/health 与 /api/review/capabilities，不调用模型、不发 Risk。"""
    health_status, health = _get("/health")
    try:
        cap_status, capabilities = _get("/api/review/capabilities")
    except CoreAgentError as exc:
        return {
            "reachable": health_status == 200,
            "base_url": base_url(),
            "health": health,
            "capabilities": None,
            "capabilities_error": str(exc),
        }
    return {
        "reachable": health_status == 200,
        "base_url": base_url(),
        "health_http_status": health_status,
        "health": health,
        "capabilities_http_status": cap_status,
        "capabilities": capabilities,
    }
