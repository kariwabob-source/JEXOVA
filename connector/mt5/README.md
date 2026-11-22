# JEXOVA MetaTrader 5 connector

The connector reads account details, open positions, historical orders, and historical deals from an already authenticated MT5 desktop terminal. It supports MT5 demo and live account modes, but does not request an MT5 password, log in to an account, or place, modify, or close orders.

## Requirements

- 64-bit Windows and 64-bit Python 3.12.
- MetaTrader 5 installed and signed in manually to the account you want to connect.
- JEXOVA available at the URL you configure during installation.

The connector must run under the same Windows user session as the MT5 terminal. JEXOVA cannot access a local terminal without this connector.

## Install and start

1. Sign in to the MT5 desktop terminal yourself.
2. Open PowerShell in this `connector\mt5` folder.
3. Run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-jexova-mt5-connector.ps1
   ```

   For an JEXOVA site hosted remotely, use its HTTPS URL:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-jexova-mt5-connector.ps1 -JEXOVAUrl "https://your-jexova.example"
   ```

The installer creates a Python virtual environment, installs the connector requirements, and registers a per-user Windows scheduled task. The task starts the local pairing bridge and background synchronization service at sign-in. It does not stop or replace an existing process or scheduled task. If port `47620` is occupied, the installer stops with an explanation and leaves that process alone.

After installation, open **Settings â†’ MetaTrader 5 â†’ Connect Trading Account**. JEXOVA sends a short-lived, single-use pairing code directly to the local connector. The connector checks the currently signed-in terminal and stores its long-lived token in Windows Credential Manager. JEXOVA displays the detected, masked account information for your confirmation; synchronization is unavailable until you confirm it.

For local development, the default JEXOVA URL is `http://127.0.0.1:8000`. This is the normal application server and uses the `jexova` database; do not point the connector at the test server on port `8001`. The local bridge listens only on `127.0.0.1:47620` and accepts browser requests only from the configured JEXOVA origin. When connecting from a remote HTTPS site, the browser may ask permission to access the local network; allow it for pairing to work. Pairing codes are not shown in the interface or logged. Connector tokens are not sent back to browser code.

## Background synchronization and account status

Once installed, the background task polls JEXOVA for requested syncs and reports connection failures. Leave MT5 open and signed in under the same Windows user. The connector reads account type from MT5's `trade_mode` and accepts demo (`0`) and real/live (`2`) modes; unsupported contest accounts are rejected. Imported orders, deals, and positions remain separate source records keyed by MT5 identifiers. Multiple deals for one position remain distinct, and manual journal trades are not overwritten.

No live account was available for an end-to-end verification in this environment. Live-account handling is covered by mocked connector and backend tests; this is not evidence of a successful real live-terminal connection.

## Disconnect or remove the connector

Use **Disconnect Account** in JEXOVA. This revokes the server token and asks the local connector to remove its saved credential. Disconnecting preserves imported records. If the connector is temporarily unavailable, use **Remove local connector access** after it is available again.

To remove automatic startup without deleting connection records from JEXOVA:

```powershell
Stop-ScheduledTask -TaskName "JEXOVA MT5 Connector" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "JEXOVA MT5 Connector" -Confirm:$false
```

The connector log at `%LOCALAPPDATA%\JEXOVA\mt5-connector.log` contains operational status and error codes only; it does not contain pairing codes, account passwords, or connector tokens.
