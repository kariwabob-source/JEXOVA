import unittest
from datetime import datetime, timezone
import json
import socket
import threading
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

import mt5_connector


class FakeMetaTrader:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_REAL = 2

    def __init__(self, *, connected=True, trade_mode=0):
        self.connected = connected
        self.trade_mode = trade_mode
        self.initialize_calls = []
        self.shutdown_calls = 0
        self.history_calls = []

    def initialize(self, *args, **kwargs):
        self.initialize_calls.append((args, kwargs))
        return True

    def shutdown(self):
        self.shutdown_calls += 1

    def terminal_info(self):
        return SimpleNamespace(connected=self.connected)

    def account_info(self):
        return SimpleNamespace(
            login=12345678,
            server="MetaQuotes-Demo",
            currency="USD",
            balance=10000.25,
            equity=10001.50,
            leverage=100,
            trade_mode=self.trade_mode,
        )

    def history_orders_get(self, start, end):
        self.history_calls.append("orders")
        return (
            SimpleNamespace(
                ticket=81001,
                position_id=7001,
                symbol="EURUSD",
                type=0,
                state=4,
                volume_initial=0.2,
                volume_current=0.0,
                price_open=1.1,
                price_current=1.1,
                time_setup=1760000000,
                time_done=1760000060,
            ),
        )

    def history_deals_get(self, start, end):
        self.history_calls.append("deals")
        return (
            SimpleNamespace(
                ticket=91001,
                order=81001,
                position_id=7001,
                symbol="EURUSD",
                type=0,
                entry=0,
                volume=0.2,
                price=1.1,
                commission=-0.5,
                swap=0.0,
                profit=0.0,
                fee=0.0,
                time=1760000000,
            ),
            SimpleNamespace(
                ticket=91002,
                order=81002,
                position_id=7001,
                symbol="EURUSD",
                type=1,
                entry=1,
                volume=0.1,
                price=1.11,
                commission=-0.25,
                swap=0.0,
                profit=1.0,
                fee=0.0,
                time=1760001800,
            ),
        )

    def positions_get(self):
        self.history_calls.append("positions")
        return (
            SimpleNamespace(
                ticket=7001,
                identifier=7001,
                symbol="EURUSD",
                type=0,
                volume=0.1,
                price_open=1.1,
                price_current=1.11,
                sl=1.09,
                tp=1.12,
                swap=0.0,
                profit=1.0,
                time=1760000000,
            ),
        )


class Mt5ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.terminal = r"C:\Program Files\MetaTrader 5\terminal64.exe"
        self.running = patch("mt5_connector.ensure_terminal_running")
        self.running.start()
        self.addCleanup(self.running.stop)

    def test_terminal_unavailable_is_reported_before_initialization(self):
        mt5 = FakeMetaTrader()

        with patch(
            "mt5_connector.ensure_terminal_running",
            side_effect=mt5_connector.ConnectorError("terminal_unavailable"),
        ):
            with self.assertRaisesRegex(mt5_connector.ConnectorError, "not running"):
                mt5_connector.read_account(mt5, self.terminal)

        self.assertEqual([], mt5.initialize_calls)

    def test_disconnected_terminal_is_rejected(self):
        mt5 = FakeMetaTrader(connected=False)

        with self.assertRaisesRegex(mt5_connector.ConnectorError, "sign in to the account"):
            mt5_connector.read_account(mt5, self.terminal)

        self.assertEqual(1, mt5.shutdown_calls)

    def test_contest_account_is_rejected_before_history_is_read(self):
        mt5 = FakeMetaTrader(trade_mode=1)

        with self.assertRaisesRegex(mt5_connector.ConnectorError, "demo and live"):
            mt5_connector.collect_snapshot(mt5, self.terminal)

        self.assertEqual([], mt5.history_calls)
        self.assertEqual(1, mt5.shutdown_calls)

    def test_demo_snapshot_keeps_partial_deals_distinct_and_never_uses_login(self):
        mt5 = FakeMetaTrader()
        snapshot = mt5_connector.collect_snapshot(mt5, self.terminal)

        self.assertEqual("12345678", snapshot["account"]["login"])
        self.assertEqual(0, snapshot["account"]["trade_mode"])
        self.assertEqual(["orders", "deals", "positions"], mt5.history_calls)
        self.assertEqual(1, len(snapshot["orders"]))
        self.assertEqual(2, len(snapshot["deals"]))
        self.assertEqual("7001", snapshot["deals"][0]["position_id"])
        self.assertEqual("7001", snapshot["deals"][1]["position_id"])
        self.assertEqual("7001", snapshot["positions"][0]["position_id"])
        self.assertEqual(1, mt5.shutdown_calls)
        self.assertEqual(self.terminal, mt5.initialize_calls[0][0][0])
        self.assertNotIn("login", mt5.initialize_calls[0][1])

    def test_live_account_is_supported_without_credential_login(self):
        mt5 = FakeMetaTrader(trade_mode=FakeMetaTrader.ACCOUNT_TRADE_MODE_REAL)

        account = mt5_connector.read_account(mt5, self.terminal)

        self.assertEqual(2, account["trade_mode"])
        self.assertEqual(1, mt5.shutdown_calls)
        self.assertNotIn("login", mt5.initialize_calls[0][1])

    def test_http_is_restricted_to_loopback_hosts(self):
        with self.assertRaisesRegex(ValueError, "only for a local"):
            mt5_connector.validate_base_url("http://example.test")

        self.assertEqual(
            "http://127.0.0.1:8000",
            mt5_connector.validate_base_url("http://127.0.0.1:8000/"),
        )
        self.assertEqual(
            "https://edgeledger.example",
            mt5_connector.validate_base_url("https://edgeledger.example"),
        )

    def test_timestamp_conversion_is_utc(self):
        result = mt5_connector._epoch_to_iso(1760000000)
        self.assertEqual(
            datetime.fromtimestamp(1760000000, tz=timezone.utc).isoformat(),
            result,
        )

    def test_local_bridge_accepts_only_the_configured_origin(self):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        handler = mt5_connector._make_local_handler(
            "http://127.0.0.1:8000",
            "http://127.0.0.1:8000",
            self.terminal,
            port,
        )
        server = mt5_connector.ThreadingHTTPServer(("127.0.0.1", port), handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        self.assertTrue(thread.is_alive())
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)

        trusted = Request(
            f"http://127.0.0.1:{port}/health",
            headers={"Origin": "http://127.0.0.1:8000"},
        )
        with urlopen(trusted, timeout=10) as response:
            self.assertEqual(200, response.status)
            self.assertEqual("http://127.0.0.1:8000", response.headers["Access-Control-Allow-Origin"])
            self.assertEqual("ready", json.loads(response.read())["data"]["status"])

        untrusted = Request(
            f"http://127.0.0.1:{port}/health",
            headers={"Origin": "https://attacker.example"},
        )
        with self.assertRaises(HTTPError) as error:
            urlopen(untrusted, timeout=10)
        self.assertEqual(403, error.exception.code)


if __name__ == "__main__":
    unittest.main()
