"""graftlab_ai: a small client for an OpenAI-compatible chat service.

Provided by GraftLab Studio (MIT). The service is chosen only through the environment:

    GL_AI_BASE_URL         base address, for example https://host/v1
    GL_AI_API_KEY          key (may be empty for a local service)
    GL_AI_MODEL            model name
    GL_AI_TIMEOUT_SECONDS  optional, default 20

Every call is synchronous and has a time limit. No function raises into the app: a failure comes back as
``Result(ok=False, error=...)``, so a page never breaks because the model is down. Use ``stub()`` in tests, so a
test never calls a real service.

    import graftlab_ai
    r = graftlab_ai.ask("You suggest tags.", "Title: Sourdough guide")
    if r.ok:
        print(r.text, r.usage)
"""

import contextlib
import json as _json
import logging
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Optional

__all__ = ["Result", "configured", "chat", "ask", "ask_json", "stub"]

logger = logging.getLogger("graftlab_ai")

_stub: Optional[Callable[[list], Any]] = None


@dataclass
class Result:
    ok: bool
    text: str = ""
    error: str = ""
    usage: dict = field(default_factory=dict)
    data: Any = None

    def __bool__(self) -> bool:
        return self.ok


def _config() -> Optional[dict]:
    base = os.environ.get("GL_AI_BASE_URL", "").strip()
    model = os.environ.get("GL_AI_MODEL", "").strip()
    if not base or not model:
        return None
    try:
        timeout = float(os.environ.get("GL_AI_TIMEOUT_SECONDS", "20"))
    except ValueError:
        timeout = 20.0
    return {"base": base.rstrip("/"), "key": os.environ.get("GL_AI_API_KEY", ""), "model": model, "timeout": timeout}


def configured() -> bool:
    """True when an address and a model are set (a stub counts as configured)."""
    return _stub is not None or _config() is not None


def _usage(u: Any) -> dict:
    if not isinstance(u, dict):
        return {}
    details = u.get("prompt_tokens_details") or {}
    return {
        "input": int(u.get("prompt_tokens") or 0),
        "cached": int((details.get("cached_tokens") if isinstance(details, dict) else 0) or u.get("prompt_cache_hit_tokens") or 0),
        "output": int(u.get("completion_tokens") or 0),
    }


def chat(messages: list, *, timeout: Optional[float] = None, max_tokens: Optional[int] = None, json: bool = False) -> Result:
    """One chat completion. ``messages`` are OpenAI-style dicts with "role" and "content"."""
    if _stub is not None:
        try:
            out = _stub(messages)
        except Exception as e:  # the stub stands for a failing service
            return Result(ok=False, error=str(e) or "stub failure")
        if isinstance(out, Result):
            return out
        return Result(ok=True, text=str(out))
    cfg = _config()
    if cfg is None:
        return Result(ok=False, error="the AI service is not configured")
    body: dict = {"model": cfg["model"], "messages": messages, "stream": False}
    if max_tokens:
        body["max_tokens"] = int(max_tokens)
    if json:
        body["response_format"] = {"type": "json_object"}
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if cfg["key"]:
        headers["Authorization"] = f"Bearer {cfg['key']}"
    req = urllib.request.Request(f"{cfg['base']}/chat/completions", data=_json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout if timeout is not None else cfg["timeout"]) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # The status only; the answer body can echo the request.
        logger.warning("AI request failed with status %s", e.code)
        e.close()
        return Result(ok=False, error=f"the AI service answered with status {e.code}")
    except Exception as e:
        logger.warning("AI request failed: %s", type(e).__name__)
        return Result(ok=False, error=f"the AI service could not be reached ({type(e).__name__})")
    try:
        text = data["choices"][0]["message"].get("content") or ""
    except (KeyError, IndexError, TypeError, AttributeError):
        return Result(ok=False, error="the AI service gave an answer in an unknown form", usage=_usage(data.get("usage") if isinstance(data, dict) else None))
    usage = _usage(data.get("usage"))
    if not text.strip():
        return Result(ok=False, error="the AI service gave an empty answer", usage=usage)
    return Result(ok=True, text=text.strip(), usage=usage)


def ask(system: str, user: str, **kw: Any) -> Result:
    """A system instruction and one user message."""
    return chat([{"role": "system", "content": system}, {"role": "user", "content": user}], **kw)


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


_TYPES = {str: "text", int: "a whole number", float: "a number", bool: "true or false", list: "a list", dict: "an object"}


def _shape_error(data: Any, expect: Any, where: str = "the answer") -> Optional[str]:
    """None when ``data`` has the shape ``expect``: a dict of key to type (or nested dict, or [type] for a list)."""
    if isinstance(expect, dict):
        if not isinstance(data, dict):
            return f"{where} is not an object"
        for key, sub in expect.items():
            if key not in data:
                return f"{where} has no {key!r}"
            err = _shape_error(data[key], sub, f"{key!r}")
            if err:
                return err
        return None
    if isinstance(expect, list):
        if not isinstance(data, list):
            return f"{where} is not a list"
        if expect:
            for i, item in enumerate(data):
                err = _shape_error(item, expect[0], f"{where}[{i}]")
                if err:
                    return err
        return None
    if isinstance(expect, type):
        ok = isinstance(data, expect) and not (expect is int and isinstance(data, bool))
        if expect is float:
            ok = isinstance(data, (int, float)) and not isinstance(data, bool)
        return None if ok else f"{where} is not {_TYPES.get(expect, expect.__name__)}"
    return None


def ask_json(system: str, user: str, *, expect: Any = None, **kw: Any) -> Result:
    """Like ask(), and parses the answer as JSON into ``Result.data`` (a code fence around it is removed).

    ``expect`` is the answer shape of the Feature's detail design, for example
    ``{"answer": str, "bookmark_ids": [int]}``; an answer of another shape is a failed result naming what is wrong.
    """
    r = ask(system + "\nAnswer with JSON only.", user, **kw)
    if not r.ok:
        return r
    try:
        r.data = _json.loads(_FENCE.sub("", r.text.strip()))
    except ValueError:
        return Result(ok=False, error="the AI answer was not valid JSON", text=r.text, usage=r.usage)
    if expect is not None:
        err = _shape_error(r.data, expect)
        if err:
            return Result(ok=False, error=f"the AI answer does not have the expected shape: {err}", text=r.text, usage=r.usage, data=r.data)
    return r


@contextlib.contextmanager
def stub(fn: Callable[[list], Any]) -> Iterator[list]:
    """Replace the service in tests: ``fn(messages)`` returns the answer text, a Result, or raises to fail.

    Yields the list of the messages lists it was called with.
    """
    global _stub
    calls: list = []
    previous = _stub

    def record(messages: list) -> Any:
        calls.append(messages)
        return fn(messages)

    _stub = record
    try:
        yield calls
    finally:
        _stub = previous
