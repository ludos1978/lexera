#!/usr/bin/env python3
"""Ludos Sync — macOS menu bar app for the ludos-sync server."""

import json
import os
import signal
import subprocess
import urllib.request
import urllib.error
from datetime import datetime

import rumps

# ── Paths ─────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

try:
    from _buildconfig import PROJECT_ROOT
except ImportError:
    PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

CLI_PATH = os.path.join(PROJECT_ROOT, "packages", "ludos-sync", "dist", "cli.js")
MACOS_SCRIPT = os.path.join(
    PROJECT_ROOT, "packages", "ludos-sync", "scripts", "start-macos.sh"
)

_xdg = os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config"))
CONFIG_PATH = os.path.join(_xdg, "ludos-sync", "sync.json")
LOG_PATH = os.path.expanduser("~/.ludos-sync.log")
ERR_LOG_PATH = os.path.expanduser("~/.ludos-sync.err.log")
PLIST_PATH = os.path.expanduser("~/Library/LaunchAgents/com.ludos.sync.plist")

_bundled_icon = os.path.join(SCRIPT_DIR, "logo.png")
ICON_PATH = _bundled_icon if os.path.isfile(_bundled_icon) else os.path.join(PROJECT_ROOT, "imgs", "logo.png")

POLL_INTERVAL = 5


# ── Helpers ───────────────────────────────────────────────────────
def find_node():
    """Locate the Node.js binary (mirrors start-macos.sh logic)."""
    for d in os.environ.get("PATH", "").split(":"):
        p = os.path.join(d, "node")
        if os.access(p, os.X_OK):
            return p
    for p in [
        os.path.expanduser("~/.nvm/current/bin/node"),
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
    ]:
        if os.access(p, os.X_OK):
            return p
    return None


def load_config():
    """Load the sync.json config file."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def fetch_status(port):
    """Poll the server /status endpoint."""
    try:
        req = urllib.request.Request(f"http://localhost:{port}/status")
        with urllib.request.urlopen(req, timeout=2) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, OSError, json.JSONDecodeError, ValueError):
        return None


# ── App ───────────────────────────────────────────────────────────
class LudosSyncApp(rumps.App):
    def __init__(self):
        super().__init__("", quit_button=None)
        if os.path.isfile(ICON_PATH):
            self.icon = ICON_PATH
        self.node_bin = find_node()
        self.server_proc = None
        self.config = load_config()
        self.port = (self.config or {}).get("port", 8080) or 8080
        self.status_data = None

        self.verbose = False

        # Persistent menu items
        self.name_item = rumps.MenuItem("Ludos Sync")
        self.name_item.set_callback(None)
        self.status_item = rumps.MenuItem("Status: Checking…")
        self.boards_item = rumps.MenuItem("Boards")
        self.boards_item.add(rumps.MenuItem("No boards"))
        self.toggle_item = rumps.MenuItem(
            "▶ Start Server", callback=self.toggle_server
        )
        self.config_item = rumps.MenuItem("Open Config…", callback=self.open_config)
        self.logs_item = rumps.MenuItem("View Logs…", callback=self.open_logs)
        self.verbose_item = rumps.MenuItem(
            "Verbose Logging", callback=self.toggle_verbose
        )
        self.verbose_item.state = False
        self.login_item = rumps.MenuItem("Start at Login", callback=self.toggle_login)
        self.login_item.state = os.path.exists(PLIST_PATH)
        self.quit_item = rumps.MenuItem("Quit", callback=self.quit_app)

        self.menu = [
            self.name_item,
            self.status_item,
            None,
            self.boards_item,
            None,
            self.toggle_item,
            self.config_item,
            self.logs_item,
            self.verbose_item,
            None,
            self.login_item,
            self.quit_item,
        ]

        # Immediate first check
        self._check_status()

    # ── Status polling ────────────────────────────────────────────
    @rumps.timer(POLL_INTERVAL)
    def _poll(self, _):
        self._check_status()

    def _check_status(self):
        self.config = load_config()
        self.port = (self.config or {}).get("port", 8080) or 8080
        prev = self.status_data
        self.status_data = fetch_status(self.port)

        # Detect subprocess exit
        if self.server_proc and self.server_proc.poll() is not None:
            self.server_proc = None

        if prev != self.status_data:
            self._refresh_ui()

    def _refresh_ui(self):
        if self.status_data:
            p = self.status_data.get("port", self.port)
            self.status_item.title = f"Status: Running on port {p}"
            self.title = ""
            self.toggle_item.title = "■ Stop Server"
        elif self.server_proc:
            self.status_item.title = "Status: Starting…"
            self.title = ""
            self.toggle_item.title = "■ Stop Server"
        else:
            self.status_item.title = "Status: Stopped"
            self.title = ""
            self.toggle_item.title = "▶ Start Server"

        self._refresh_boards()
        self.login_item.state = os.path.exists(PLIST_PATH)

    def _refresh_boards(self):
        self.boards_item.clear()
        boards = (self.status_data or {}).get("boards", [])
        if not boards:
            self.boards_item.add(rumps.MenuItem("No boards"))
            return

        cfg = self.config or {}
        workspaces = cfg.get("workspaces", {})

        for b in boards:
            fpath = b.get("file", "?")
            name = os.path.basename(fpath)
            ws_label = ""
            bm_on = cfg.get("bookmarks", {}).get("enabled", False)
            cal_on = cfg.get("calendar", {}).get("enabled", False)

            for ws_name, ws_cfg in workspaces.items():
                for bc in ws_cfg.get("boards", []):
                    if bc.get("file") == fpath:
                        name = bc.get("name", name)
                        ws_label = ws_name
                        bm_on = bc.get(
                            "bookmarkSync",
                            ws_cfg.get("bookmarkSync", bm_on),
                        )
                        cal_on = bc.get(
                            "calendarSync",
                            ws_cfg.get("calendarSync", cal_on),
                        )
                        break

            label = f"{name} ({ws_label})" if ws_label else name
            sub = rumps.MenuItem(label)
            sub.add(rumps.MenuItem(f"📁 {fpath}"))

            ts = b.get("lastModified", "")
            if ts:
                try:
                    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    ts = dt.strftime("%Y-%m-%d %H:%M")
                except (ValueError, TypeError):
                    pass
                sub.add(rumps.MenuItem(f"Last modified: {ts}"))

            sub.add(rumps.MenuItem(f"Bookmarks: {'✓' if bm_on else '✗'}"))
            sub.add(rumps.MenuItem(f"Calendar: {'✓' if cal_on else '✗'}"))
            self.boards_item.add(sub)

    # ── Actions ───────────────────────────────────────────────────
    def toggle_server(self, _):
        is_running = self.status_data or (
            self.server_proc and self.server_proc.poll() is None
        )
        if is_running:
            self._stop()
        else:
            self._start()

    def _start(self):
        if not self.node_bin:
            rumps.alert("Node.js not found", "Install via: brew install node")
            return
        if not os.path.isfile(CLI_PATH):
            rumps.alert(
                "Server not built",
                f"CLI not found at:\n{CLI_PATH}\n\nRun build-packages.sh first.",
            )
            return

        cmd = [self.node_bin, CLI_PATH, "start"]
        if os.path.isfile(CONFIG_PATH):
            cmd += ["--config", CONFIG_PATH]
        if self.verbose:
            cmd += ["--verbose"]

        log = open(LOG_PATH, "a")
        err = open(ERR_LOG_PATH, "a")
        self.server_proc = subprocess.Popen(
            cmd, stdout=log, stderr=err, cwd=PROJECT_ROOT
        )
        log.close()
        err.close()

        self.title = ""
        self.status_item.title = "Status: Starting…"
        self.toggle_item.title = "■ Stop Server"

    def _stop(self):
        if self.server_proc and self.server_proc.poll() is None:
            self.server_proc.terminate()
            try:
                self.server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_proc.kill()
        else:
            try:
                r = subprocess.run(
                    ["pgrep", "-f", "node.*ludos-sync.*cli"],
                    capture_output=True,
                    text=True,
                )
                for pid in r.stdout.strip().split("\n"):
                    if pid:
                        os.kill(int(pid), signal.SIGTERM)
            except (ProcessLookupError, ValueError, OSError):
                pass

        self.status_data = None
        self.server_proc = None
        self.title = ""
        self.status_item.title = "Status: Stopped"
        self.toggle_item.title = "▶ Start Server"
        self._refresh_boards()

    def toggle_verbose(self, sender):
        self.verbose = not self.verbose
        sender.state = self.verbose
        # Restart server if running so the flag takes effect
        is_running = self.status_data or (
            self.server_proc and self.server_proc.poll() is None
        )
        if is_running:
            self._stop()
            self._start()

    def open_config(self, _):
        if os.path.isfile(CONFIG_PATH):
            subprocess.call(["open", CONFIG_PATH])
        else:
            rumps.alert("Config not found", f"Expected at:\n{CONFIG_PATH}")

    def open_logs(self, _):
        if os.path.isfile(LOG_PATH):
            subprocess.call(["open", LOG_PATH])
        else:
            rumps.alert("No logs", f"No log file at:\n{LOG_PATH}")

    def toggle_login(self, sender):
        if sender.state:
            subprocess.call([MACOS_SCRIPT, "--uninstall"])
        else:
            subprocess.call([MACOS_SCRIPT, "--install"])
        sender.state = os.path.exists(PLIST_PATH)

    def quit_app(self, _):
        rumps.quit_application()


if __name__ == "__main__":
    LudosSyncApp().run()
