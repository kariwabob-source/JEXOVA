from __future__ import annotations

import argparse
import getpass
import json
import logging
import math
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_TERMINAL = r"C:\Program Files\MetaTrader 5\terminal64.exe"
KEYRING_SERVICE = "EdgeLedger MT5 connector"
HISTORY_START = datetime(2000, 1, 1, tzinfo=timezone.utc)
ERROR_MESSAGES = {
    "account_mismatch": "The terminal account does not match the connected trading account.",
    "connector_error": "The connector could not complete the request.",
    "credential_store_unavailable": "Windows Credential Manager could not store or retrieve the connector token.",
    "history_unavailable": "MetaTrader 5 could not provide trading history.",
    "invalid_mt5_data": "MetaTrader 5 returned data that failed validation.",
    "local_port_unavailable": "Local connector port 47620 is already in use.",
    "mt5_package_missing": "Install the connector requirements before running it.",
    "pairing_code_expired": "The pairing code is invalid or expired. Create a new code in EdgeLedger.",
    "terminal_disconnected": "Open MetaTrader 5 and sign in to the account you want to connect.",
    "terminal_unavailable": "The configured MetaTrader 5 terminal is not running.",
    "unsupported_account_type": "This connector supports MT5 demo and live accounts only.",
    "unsupported_platform": "The connector requires 64-bit Windows.",
}
LOCAL_HOST = "127.0.0.1"
LOCAL_PORT = 47620
LOCAL_CONNECTIONS_FILE = "mt5-connections.json"
PAIRING_CODE_PATTERN = re.compile(r"\A[a-f0-9]{64}\Z", re.IGNORECASE)
MT5_LOCK = threading.RLock()


class ConnectorError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(ERROR_MESSAGES.get(code, ERROR_MESSAGES["connector_error"]))


def validate_base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Use an http:// or https:// EdgeLedger URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The EdgeLedger URL must not contain credentials or query parameters.")
    if parsed.scheme == "http" and parsed.hostname.casefold() not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("HTTP is allowed only for a local EdgeLedger server; use HTTPS for remote servers.")
    return base_url.rstrip("/")


def ensure_terminal_running(terminal_path: str, process_iter: Any = None) -> None:
    if os.name != "nt":
        raise ConnectorError("unsupported_platform")

    expected = os.path.normcase(os.path.realpath(terminal_path))
    process_errors: tuple[type[BaseException], ...] = (AttributeError, OSError)
    if process_iter is None:
        try:
            import psutil
        except ImportError as error:
            raise ConnectorError("mt5_package_missing") from error
        process_iter = psutil.process_iter
        process_errors += (psutil.Error,)

    for process in process_iter(["name", "exe"]):
        try:
            name = (process.info.get("name") or "").casefold()
            executable = process.info.get("exe")
        except process_errors:
            continue
        if name == Path(terminal_path).name.casefold() and executable:
            if os.path.normcase(os.path.realpath(executable)) == expected:
                return

    raise ConnectorError("terminal_unavailable")


def _read_record(record: Any) -> dict[str, Any]:
    if hasattr(record, "_asdict"):
        values = record._asdict()
    elif isinstance(record, dict):
        values = record
    else:
        values = vars(record)

    normalized: dict[str, Any] = {}
    for key, value in values.items():
        if isinstance(value, datetime):
            normalized[key] = (
                value.astimezone(timezone.utc).isoformat()
                if value.tzinfo
                else value.replace(tzinfo=timezone.utc).isoformat()
            )
        elif isinstance(value, float):
            if not math.isfinite(value):
                raise ConnectorError("invalid_mt5_data")
            normalized[key] = value
        elif isinstance(value, (str, int, bool)) or value is None:
            normalized[key] = value
        else:
            normalized[key] = str(value)
    return normalized


def _epoch_to_iso(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except (OverflowError, OSError, TypeError, ValueError):
        raise ConnectorError("invalid_mt5_data") from None


def _account_payload(account: Any) -> dict[str, Any]:
    record = _read_record(account)
    try:
        return {
            "login": str(int(record["login"])),
            "server": str(record["server"]),
            "currency": str(record["currency"]).upper(),
            "balance": record["balance"],
            "equity": record["equity"],
            "leverage": int(record["leverage"]),
            "trade_mode": int(record["trade_mode"]),
        }
    except (KeyError, TypeError, ValueError):
        raise ConnectorError("invalid_mt5_data") from None


def _require_supported_account(account: Any, mt5_module: Any) -> dict[str, Any]:
    if account is None:
        raise ConnectorError("terminal_disconnected")
    data = _account_payload(account)
    demo_mode = getattr(mt5_module, "ACCOUNT_TRADE_MODE_DEMO", 0)
    live_mode = getattr(mt5_module, "ACCOUNT_TRADE_MODE_REAL", 2)
    if data["trade_mode"] not in {demo_mode, live_mode}:
        raise ConnectorError("unsupported_account_type")
    if not data["server"] or len(data["currency"]) != 3 or not data["currency"].isalpha():
        raise ConnectorError("invalid_mt5_data")
    return data


def _connect(mt5_module: Any, terminal_path: str) -> dict[str, Any]:
    ensure_terminal_running(terminal_path)
    try:
        initialized = mt5_module.initialize(terminal_path, timeout=10_000)
    except Exception as error:
        raise ConnectorError("terminal_unavailable") from error
    if not initialized:
        raise ConnectorError("terminal_unavailable")

    try:
        terminal = mt5_module.terminal_info()
        if terminal is None or not bool(_read_record(terminal).get("connected")):
            raise ConnectorError("terminal_disconnected")
        return _require_supported_account(mt5_module.account_info(), mt5_module)
    except ConnectorError:
        mt5_module.shutdown()
        raise
    except Exception as error:
        mt5_module.shutdown()
        raise ConnectorError("terminal_disconnected") from error


def read_account(mt5_module: Any, terminal_path: str = DEFAULT_TERMINAL) -> dict[str, Any]:
    with MT5_LOCK:
        account = _connect(mt5_module, terminal_path)
        mt5_module.shutdown()
        return account


def collect_snapshot(mt5_module: Any, terminal_path: str = DEFAULT_TERMINAL) -> dict[str, Any]:
    with MT5_LOCK:
        account = _connect(mt5_module, terminal_path)
        try:
            now = datetime.now(timezone.utc)
            raw_orders = mt5_module.history_orders_get(HISTORY_START, now)
            raw_deals = mt5_module.history_deals_get(HISTORY_START, now)
            raw_positions = mt5_module.positions_get()
            if raw_orders is None or raw_deals is None or raw_positions is None:
                raise ConnectorError("history_unavailable")

            orders = []
            for item in raw_orders:
                data = _read_record(item)
                orders.append({
                    "ticket": str(data["ticket"]),
                    "position_id": str(data["position_id"]) if data.get("position_id") else None,
                    "symbol": data.get("symbol"),
                    "order_type": str(data.get("type")) if data.get("type") is not None else None,
                    "state": str(data.get("state")) if data.get("state") is not None else None,
                    "volume_initial": data.get("volume_initial"),
                    "volume_current": data.get("volume_current"),
                    "price_open": data.get("price_open"),
                    "price_current": data.get("price_current"),
                    "time_setup": _epoch_to_iso(data.get("time_setup")),
                    "time_done": _epoch_to_iso(data.get("time_done")),
                    "payload": data,
                })

            deals = []
            for item in raw_deals:
                data = _read_record(item)
                deals.append({
                    "ticket": str(data["ticket"]),
                    "order_ticket": str(data["order"]) if data.get("order") else None,
                    "position_id": str(data["position_id"]) if data.get("position_id") else None,
                    "symbol": data.get("symbol"),
                    "deal_type": str(data.get("type")) if data.get("type") is not None else None,
                    "entry_type": str(data.get("entry")) if data.get("entry") is not None else None,
                    "volume": data.get("volume"),
                    "price": data.get("price"),
                    "commission": data.get("commission", 0),
                    "swap": data.get("swap", 0),
                    "profit": data.get("profit", 0),
                    "fee": data.get("fee", 0),
                    "occurred_at": _epoch_to_iso(data.get("time")),
                    "payload": data,
                })

            positions = []
            for item in raw_positions:
                data = _read_record(item)
                positions.append({
                    "ticket": str(data["ticket"]),
                    "position_id": str(data["identifier"]) if data.get("identifier") else None,
                    "symbol": data.get("symbol"),
                    "position_type": str(data.get("type")) if data.get("type") is not None else None,
                    "volume": data.get("volume"),
                    "price_open": data.get("price_open"),
                    "price_current": data.get("price_current"),
                    "stop_loss": data.get("sl"),
                    "take_profit": data.get("tp"),
                    "swap": data.get("swap", 0),
                    "profit": data.get("profit", 0),
                    "opened_at": _epoch_to_iso(data.get("time")),
                    "payload": data,
                })

            return {"account": account, "orders": orders, "deals": deals, "positions": positions}
        except ConnectorError:
            raise
        except Exception as error:
            raise ConnectorError("history_unavailable") from error
        finally:
            mt5_module.shutdown()


def _request_json(
    base_url: str,
    path: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    url = f"{validate_base_url(base_url)}{path}"
    headers = {"Accept": "application/json"}
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            content = response.read()
            result = json.loads(content) if content else {}
            if not isinstance(result, dict):
                raise ConnectorError("invalid_mt5_data")
            return result
    except HTTPError as error:
        if error.code == 409:
            if path == "/api/mt5/pair":
                raise ConnectorError("pairing_code_expired") from None
            raise ConnectorError("account_mismatch") from None
        if error.code == 422:
            if path == "/api/mt5/pair":
                raise ConnectorError("pairing_code_expired") from None
            raise ConnectorError("invalid_mt5_data") from None
        if error.code in {401, 403}:
            raise ConnectorError("connector_error") from None
        raise ConnectorError("connector_error") from None
    except (URLError, TimeoutError, OSError, json.JSONDecodeError):
        raise ConnectorError("connector_error") from None


def _credential_store():
    try:
        import keyring
    except ImportError as error:
        raise ConnectorError("mt5_package_missing") from error
    return keyring


def _store_token(base_url: str, connection_id: int, token: str) -> None:
    keyring = _credential_store()
    try:
        keyring.set_password(KEYRING_SERVICE, f"{base_url}|{connection_id}", token)
    except keyring.errors.KeyringError as error:
        raise ConnectorError("credential_store_unavailable") from error


def _get_token(base_url: str, connection_id: int) -> str:
    keyring = _credential_store()
    try:
        token = keyring.get_password(KEYRING_SERVICE, f"{base_url}|{connection_id}")
    except keyring.errors.KeyringError as error:
        raise ConnectorError("credential_store_unavailable") from error
    if not token:
        raise ConnectorError("credential_store_unavailable")
    return token


def forget(base_url: str, connection_id: int) -> None:
    keyring = _credential_store()
    try:
        keyring.delete_password(KEYRING_SERVICE, f"{base_url}|{connection_id}")
    except keyring.errors.PasswordDeleteError:
        raise ConnectorError("credential_store_unavailable") from None
    print(f"Removed the saved token for connection {connection_id}.")


def pair(base_url: str, terminal_path: str) -> int:
    code = getpass.getpass("One-time EdgeLedger pairing code: ").strip()
    result = _request_json(
        base_url,
        "/api/mt5/pair",
        method="POST",
        payload={"pairing_code": code},
    )
    data = result["data"]
    connection_id = int(data["connection_id"])
    token = data["connector_token"]
    _store_token(base_url, connection_id, token)

    try:
        import MetaTrader5 as mt5
    except ImportError as error:
        _set_connection_error(base_url, token, "mt5_package_missing")
        raise ConnectorError("mt5_package_missing") from error

    try:
        account = read_account(mt5, terminal_path)
        _set_connection_status(base_url, token, account)
    except ConnectorError as error:
        _set_connection_error(base_url, token, error.code)
        raise

    account_type = "demo" if account["trade_mode"] == 0 else "live"
    print(f"Paired to a verified {account_type} terminal. Confirm this account in EdgeLedger.")
    print(f"Next: run mt5_connector.py watch --connection-id {connection_id}")
    return connection_id


def _set_connection_status(base_url: str, token: str, account: dict[str, Any]) -> None:
    _request_json(
        base_url,
        "/api/mt5/connector/status",
        method="POST",
        payload={"status": "connected", "account": account},
        token=token,
    )


def _set_connection_error(base_url: str, token: str, error_code: str) -> None:
    _request_json(
        base_url,
        "/api/mt5/connector/status",
        method="POST",
        payload={"status": "error", "error_code": error_code},
        token=token,
    )


def watch(base_url: str, connection_id: int, terminal_path: str, poll_interval: int) -> None:
    token = _get_token(base_url, connection_id)
    try:
        import MetaTrader5 as mt5
    except ImportError as error:
        _set_connection_error(base_url, token, "mt5_package_missing")
        raise ConnectorError("mt5_package_missing") from error

    print("MT5 connector is running in read-only mode. Press Ctrl+C to stop.")
    while True:
        _process_connection(base_url, connection_id, token, terminal_path, mt5)
        time.sleep(poll_interval)


def _process_connection(
    base_url: str,
    connection_id: int,
    token: str,
    terminal_path: str,
    mt5_module: Any,
) -> None:
    job_id = None
    try:
        account = read_account(mt5_module, terminal_path)
        _set_connection_status(base_url, token, account)
        job = _request_json(
            base_url,
            "/api/mt5/connector/jobs/next",
            token=token,
        ).get("data")
        if job is None:
            return

        job_id = int(job["id"])
        snapshot = collect_snapshot(mt5_module, terminal_path)
        _request_json(
            base_url,
            f"/api/mt5/connector/jobs/{job_id}/complete",
            method="POST",
            payload=snapshot,
            token=token,
        )
        logging.info("Synchronization completed for connection %s.", connection_id)
    except ConnectorError as error:
        if job_id is not None:
            try:
                _request_json(
                    base_url,
                    f"/api/mt5/connector/jobs/{job_id}/fail",
                    method="POST",
                    payload={"error_code": error.code},
                    token=token,
                )
            except ConnectorError as report_error:
                logging.warning("Could not report sync failure: %s", report_error.code)
        elif error.code != "connector_error":
            try:
                _set_connection_error(base_url, token, error.code)
            except ConnectorError as report_error:
                logging.warning("Could not report connector state: %s", report_error.code)
        logging.warning("Connection %s needs attention: %s", connection_id, error.code)


def _registry_path() -> Path:
    root = os.environ.get("LOCALAPPDATA")
    if not root:
        root = str(Path.home() / "AppData" / "Local")
    directory = Path(root) / "EdgeLedger"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / LOCAL_CONNECTIONS_FILE


def _load_connections() -> list[dict[str, Any]]:
    path = _registry_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError
        connections = []
        for item in data:
            if not isinstance(item, dict):
                raise ValueError
            connection_id = int(item["connection_id"])
            base_url = validate_base_url(str(item["base_url"]))
            connections.append({"connection_id": connection_id, "base_url": base_url})
        return connections
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise ConnectorError("invalid_mt5_data") from None


def _save_connections(connections: list[dict[str, Any]]) -> None:
    path = _registry_path()
    temporary_path = path.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(connections, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary_path, path)


def _register_connection(base_url: str, connection_id: int) -> None:
    connections = _load_connections()
    if not any(item["connection_id"] == connection_id and item["base_url"] == base_url for item in connections):
        connections.append({"connection_id": connection_id, "base_url": base_url})
        _save_connections(connections)


def _forget_connection(base_url: str, connection_id: int) -> None:
    forget(base_url, connection_id)
    connections = _load_connections()
    _save_connections([
        item for item in connections
        if not (item["connection_id"] == connection_id and item["base_url"] == base_url)
    ])


def _origin_for(base_url: str) -> str:
    parsed = urlparse(validate_base_url(base_url))
    return f"{parsed.scheme}://{parsed.netloc}"


def _masked_login(login: str) -> str:
    return "*" * max(4, len(login) - 4) + login[-4:]


def _pair_local(base_url: str, pairing_code: str, terminal_path: str) -> dict[str, Any]:
    if not PAIRING_CODE_PATTERN.fullmatch(pairing_code):
        raise ConnectorError("pairing_code_expired")
    try:
        import MetaTrader5 as mt5
    except ImportError as error:
        raise ConnectorError("mt5_package_missing") from error

    account = read_account(mt5, terminal_path)
    paired = _request_json(
        base_url,
        "/api/mt5/pair",
        method="POST",
        payload={"pairing_code": pairing_code},
    )["data"]
    connection_id = int(paired["connection_id"])
    token = str(paired["connector_token"])
    _store_token(base_url, connection_id, token)
    _register_connection(base_url, connection_id)
    _set_connection_status(base_url, token, account)

    return {
        "connection_id": connection_id,
        "login_masked": _masked_login(account["login"]),
        "server": account["server"],
        "currency": account["currency"],
        "account_type": "demo" if account["trade_mode"] == 0 else "live",
        "balance": account["balance"],
        "equity": account["equity"],
        "leverage": account["leverage"],
    }


def _make_local_handler(base_url: str, allowed_origin: str, terminal_path: str, port: int):
    class LocalConnectorHandler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _authorized_local_request(self) -> bool:
            if self.client_address[0] not in {"127.0.0.1", "::1"}:
                self._send_json(403, {"error": "local_only"})
                return False
            if self.headers.get("Host") != f"{LOCAL_HOST}:{port}":
                self._send_json(403, {"error": "invalid_host"})
                return False
            if self.headers.get("Origin") != allowed_origin:
                self._send_json(403, {"error": "invalid_origin"})
                return False
            return True

        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if self.headers.get("Origin") == allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            if not self._authorized_local_request():
                return
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self) -> None:
            if not self._authorized_local_request():
                return
            if self.path != "/health":
                self._send_json(404, {"error": "not_found"})
                return
            self._send_json(200, {"data": {"status": "ready"}})

        def do_POST(self) -> None:
            if not self._authorized_local_request():
                return
            if self.path not in {"/pair", "/disconnect"}:
                self._send_json(404, {"error": "not_found"})
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length < 2 or content_length > 2048:
                    raise ValueError
                payload = json.loads(self.rfile.read(content_length))
                if not isinstance(payload, dict):
                    raise ValueError
            except (ValueError, json.JSONDecodeError):
                self._send_json(400, {"error": "invalid_request"})
                return

            try:
                if self.path == "/pair":
                    data = _pair_local(base_url, str(payload.get("pairing_code", "")), terminal_path)
                    self._send_json(200, {"data": data})
                else:
                    connection_id = int(payload["connection_id"])
                    _forget_connection(base_url, connection_id)
                    self._send_json(200, {"data": {"status": "disconnected"}})
            except (ConnectorError, KeyError, TypeError, ValueError) as error:
                code = error.code if isinstance(error, ConnectorError) else "invalid_mt5_data"
                self._send_json(422 if code == "pairing_code_expired" else 503, {"error": code})

    return LocalConnectorHandler


def serve(
    base_url: str,
    terminal_path: str,
    port: int = LOCAL_PORT,
    poll_interval: int = 5,
) -> None:
    base_url = validate_base_url(base_url)
    allowed_origin = _origin_for(base_url)
    if port < 1 or port > 65535:
        raise ValueError("--port must be between 1 and 65535.")

    try:
        import MetaTrader5 as mt5
    except ImportError:
        mt5 = None

    log_path = _registry_path().with_name("mt5-connector.log")
    logging.basicConfig(filename=log_path, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    handler = _make_local_handler(base_url, allowed_origin, terminal_path, port)
    try:
        server = ThreadingHTTPServer((LOCAL_HOST, port), handler)
    except OSError as error:
        raise ConnectorError("local_port_unavailable") from error
    server.daemon_threads = True
    logging.info("Local MT5 connector started on %s:%s.", LOCAL_HOST, port)

    stop_event = threading.Event()

    def poll_connections() -> None:
        while not stop_event.is_set():
            if mt5 is not None:
                try:
                    connections = _load_connections()
                    for item in connections:
                        try:
                            token = _get_token(item["base_url"], item["connection_id"])
                            _process_connection(
                                item["base_url"],
                                item["connection_id"],
                                token,
                                terminal_path,
                                mt5,
                            )
                        except ConnectorError as error:
                            logging.warning("Connection %s needs attention: %s", item["connection_id"], error.code)
                except ConnectorError as error:
                    logging.error("Could not read the connector registry: %s", error.code)
            stop_event.wait(poll_interval)

    worker = threading.Thread(target=poll_connections, name="mt5-sync-worker", daemon=True)
    worker.start()
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        stop_event.set()
        server.server_close()
        worker.join(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only EdgeLedger MetaTrader 5 connector.")
    commands = parser.add_subparsers(dest="command", required=True)
    pair_parser = commands.add_parser("pair", help="Pair this terminal with a one-time EdgeLedger code.")
    pair_parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    pair_parser.add_argument("--terminal-path", default=DEFAULT_TERMINAL)
    watch_parser = commands.add_parser("watch", help="Poll EdgeLedger for requested syncs.")
    watch_parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    watch_parser.add_argument("--terminal-path", default=DEFAULT_TERMINAL)
    watch_parser.add_argument("--connection-id", required=True, type=int)
    watch_parser.add_argument("--poll-interval", type=int, default=5)
    forget_parser = commands.add_parser("forget", help="Remove a saved connector token from Windows Credential Manager.")
    forget_parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    forget_parser.add_argument("--connection-id", required=True, type=int)
    serve_parser = commands.add_parser("serve", help="Run the local pairing bridge and background sync service.")
    serve_parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    serve_parser.add_argument("--terminal-path", default=DEFAULT_TERMINAL)
    serve_parser.add_argument("--port", type=int, default=LOCAL_PORT)
    serve_parser.add_argument("--poll-interval", type=int, default=5)

    args = parser.parse_args()
    try:
        base_url = validate_base_url(args.base_url)
        if args.command == "pair":
            pair(base_url, args.terminal_path)
        elif args.command == "watch":
            if args.poll_interval < 2 or args.poll_interval > 300:
                raise ValueError("--poll-interval must be between 2 and 300 seconds.")
            watch(base_url, args.connection_id, args.terminal_path, args.poll_interval)
        elif args.command == "forget":
            forget(base_url, args.connection_id)
        else:
            if args.poll_interval < 2 or args.poll_interval > 300:
                raise ValueError("--poll-interval must be between 2 and 300 seconds.")
            serve(base_url, args.terminal_path, args.port, args.poll_interval)
    except (ConnectorError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nMT5 connector stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
