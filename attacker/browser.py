"""Headless-browser XSS proof via Playwright.

The raw HTTP tools can see a payload reflected in a response body, but only a
real browser proves it *executes*. This loads HTML (a captured response body) or
navigates to an in-scope URL, then reports whether script actually ran — a dialog
fired (alert/confirm/prompt) or a marker variable got set. That DOM-exec signal is
the hard proof the judge needs for stored/reflected XSS.

Playwright is in the venv; the chromium browser may or may not be downloaded. If
it is missing, the tool degrades to a clear, actionable error instead of crashing.
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlsplit

from . import config

MARKER = "__XSSFIRED"
_INSTALL_HINT = "chromium not installed — run: .venv/bin/python -m playwright install chromium"


def _in_scope_request(req_url: str) -> bool:
    """Scope floor for the browser: only the target host, plus inert local
    schemes (data:/blob:/about:), may be fetched. Everything else is aborted,
    so a payload's off-host sub-resource or an off-host redirect cannot reach
    the network (no SSRF via the headless browser)."""
    u = urlsplit(req_url)
    if u.scheme in ("data", "blob", "about", ""):
        return True
    return u.netloc == config.ALLOWED_NETLOC


async def run(
    url: Optional[str] = None,
    html: Optional[str] = None,
    marker_var: str = MARKER,
    wait_ms: int = 500,
) -> dict[str, Any]:
    """Load `html` (raw response body) or navigate to `url`, return whether JS
    executed. Detection = any JS dialog fired OR window[marker_var] is truthy.

    Use a payload that sets the marker, e.g.
    `<img src=x onerror="window.__XSSFIRED=1">` or `<script>alert(1)</script>`.
    """
    try:
        from playwright.async_api import async_playwright
    except Exception as exc:  # pragma: no cover - import guard
        return {"error": "playwright_unavailable", "detail": str(exc)}

    dialogs: list[str] = []
    try:
        async with async_playwright() as p:
            try:
                browser = await p.chromium.launch(args=["--no-sandbox"])
            except Exception as exc:
                return {"error": "browser_unavailable", "detail": str(exc), "hint": _INSTALL_HINT}
            blocked: list[str] = []
            try:
                page = await browser.new_page()

                async def _on_dialog(dialog) -> None:
                    dialogs.append(f"{dialog.type}:{dialog.message}")
                    await dialog.dismiss()

                page.on("dialog", _on_dialog)

                # Scope lock for the browser: abort any off-host request so a
                # payload cannot SSRF the internet via an <img>/<script> src or
                # an off-host redirect.
                async def _route(route) -> None:
                    if _in_scope_request(route.request.url):
                        await route.continue_()
                    else:
                        blocked.append(route.request.url)
                        await route.abort()

                await page.route("**/*", _route)

                if html is not None:
                    await page.set_content(html, wait_until="load")
                elif url is not None:
                    await page.goto(url, wait_until="load", timeout=8000)
                else:
                    return {"error": "provide either html or url"}

                await page.wait_for_timeout(wait_ms)
                try:
                    marker = await page.evaluate(f"() => window['{marker_var}'] || null")
                except Exception:
                    marker = None
            finally:
                await browser.close()
    except Exception as exc:
        return {"error": "render_failed", "detail": str(exc)}

    fired = bool(dialogs) or marker not in (None, False, 0, "")
    return {
        "fired": fired,
        "dialogs": dialogs,
        "marker": marker,
        "blocked_offhost": blocked,
        "source": "html" if html is not None else "url",
    }
