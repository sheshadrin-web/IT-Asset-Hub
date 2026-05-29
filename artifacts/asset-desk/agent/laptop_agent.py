"""
Miles IT Assets — Laptop Agent (Phase 1)

Cross-platform: Windows, macOS, Linux (Ubuntu/Debian/RHEL).

Lightweight agent that:
  - Registers the laptop with the portal using a one-time MILES_AGENT_TOKEN
  - Syncs system info every SYNC_INTERVAL_SECONDS
  - Polls for safe commands (sync_now, collect_system_info, update_wallpaper)
  - Reports command results

Packaging as a single binary via PyInstaller:
    pip install pyinstaller requests
    pyinstaller --onefile --noconsole --name miles-agent laptop_agent.py
    # → dist/miles-agent.exe (Windows) | dist/miles-agent (macOS/Linux)

One-time install (admin):
    # Windows
    setx MILES_AGENT_TOKEN "mil_xxxxxxxxxxxx" /M
    miles-agent.exe register
    # macOS / Linux
    export MILES_AGENT_TOKEN="mil_xxxxxxxxxxxx"
    ./miles-agent register

No destructive commands implemented in Phase 1.
"""
from __future__ import annotations

import os
import sys
import json
import time
import socket
import platform
import subprocess
import shutil
import shlex
import tempfile
import uuid
import hashlib
from datetime import datetime, timezone

import requests

AGENT_VERSION       = "0.2.0"
DEFAULT_API_BASE    = "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/agent-api"
API_BASE            = os.environ.get("MILES_AGENT_API_BASE", DEFAULT_API_BASE)
TOKEN               = os.environ.get("MILES_AGENT_TOKEN", "")
SYNC_INTERVAL_SEC   = int(os.environ.get("MILES_AGENT_SYNC_INTERVAL", "300"))  # 5 min
HTTP_TIMEOUT_SEC    = 30

EMPLOYEE_EMAIL      = os.environ.get("MILES_EMPLOYEE_EMAIL", "")
EMPLOYEE_ECODE      = os.environ.get("MILES_EMPLOYEE_ECODE", "")

IS_WIN  = sys.platform.startswith("win")
IS_MAC  = sys.platform == "darwin"
IS_LIN  = sys.platform.startswith("linux")


# ── shell helper ────────────────────────────────────────────────────────────
def _run(cmd: list[str], timeout: int = 15) -> str:
    """Run a command and return stripped stdout. Empty string on any failure."""
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=timeout)
        return out.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def _ps(snippet: str) -> str:
    return _run(["powershell", "-NoProfile", "-Command", snippet])


def _wmic_kv(cls: str, field: str) -> str:
    text = _run(["wmic", cls, "get", field, "/value"])
    for line in text.splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            if k.strip().lower() == field.lower():
                return v.strip()
    return ""


def _sysctl(key: str) -> str:
    return _run(["sysctl", "-n", key])


def _ioreg_serial() -> str:
    """macOS serial number via ioreg."""
    text = _run(["ioreg", "-l"])
    for line in text.splitlines():
        if '"IOPlatformSerialNumber"' in line:
            # ... "IOPlatformSerialNumber" = "C02XXXXXXXX"
            return line.split("=", 1)[-1].strip().strip('"').strip()
    return ""


def _read_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    except Exception:
        return ""


# ── per-OS collectors ───────────────────────────────────────────────────────
def _collect_windows() -> dict:
    ram_raw = _wmic_kv("computersystem", "TotalPhysicalMemory")
    ram_gb  = f"{round(int(ram_raw) / (1024**3))} GB" if ram_raw.isdigit() else ""
    storage = _ps("[math]::Round((Get-CimInstance Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum / 1GB)")
    return {
        "serial_number": _wmic_kv("bios", "SerialNumber"),
        "brand":         _wmic_kv("computersystem", "Manufacturer"),
        "model":         _wmic_kv("computersystem", "Model"),
        "processor":     _wmic_kv("cpu", "Name"),
        "ram":           ram_gb,
        "storage":       f"{storage} GB" if storage.isdigit() else "",
        "os_name":       "Windows",
        "os_version":    _ps("(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version"),
    }


def _collect_macos() -> dict:
    model    = _sysctl("hw.model")           # e.g. "MacBookPro18,2"
    cpu      = _sysctl("machdep.cpu.brand_string") or _sysctl("hw.model")
    mem_raw  = _sysctl("hw.memsize")
    ram_gb   = f"{round(int(mem_raw) / (1024**3))} GB" if mem_raw.isdigit() else ""
    # Total storage: sum of physical disks via diskutil
    disk_json = _run(["diskutil", "info", "-plist", "/"])  # may be plist, ignore — use df fallback
    df = _run(["df", "-k", "/"])
    storage = ""
    if df:
        lines = df.splitlines()
        if len(lines) >= 2:
            parts = lines[1].split()
            if len(parts) >= 2 and parts[1].isdigit():
                storage = f"{round(int(parts[1]) / (1024**2))} GB"
    os_ver = _run(["sw_vers", "-productVersion"])
    os_name_full = _run(["sw_vers", "-productName"]) or "macOS"
    return {
        "serial_number": _ioreg_serial(),
        "brand":         "Apple",
        "model":         model,
        "processor":     cpu,
        "ram":           ram_gb,
        "storage":       storage,
        "os_name":       os_name_full,
        "os_version":    os_ver,
    }


def _collect_linux() -> dict:
    # Brand / model / serial from DMI (requires read access — usually root for serial)
    brand   = _read_file("/sys/class/dmi/id/sys_vendor")
    model   = _read_file("/sys/class/dmi/id/product_name")
    serial  = _read_file("/sys/class/dmi/id/product_serial") or _read_file("/sys/class/dmi/id/board_serial")
    # Processor from /proc/cpuinfo
    cpu = ""
    cpuinfo = _read_file("/proc/cpuinfo")
    for line in cpuinfo.splitlines():
        if line.lower().startswith("model name"):
            cpu = line.split(":", 1)[-1].strip(); break
    # RAM from /proc/meminfo
    ram_gb = ""
    meminfo = _read_file("/proc/meminfo")
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            kb = int(line.split()[1])
            ram_gb = f"{round(kb / (1024 * 1024))} GB"; break
    # Storage: sum of mounted block devices via `lsblk`
    storage = ""
    lsblk = _run(["lsblk", "-bdn", "-o", "SIZE,TYPE"])
    if lsblk:
        total = 0
        for line in lsblk.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "disk" and parts[0].isdigit():
                total += int(parts[0])
        if total > 0:
            storage = f"{round(total / (1024**3))} GB"
    # OS info
    os_release = _read_file("/etc/os-release")
    os_name = "Linux"
    os_version = platform.release()
    for line in os_release.splitlines():
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[-1].strip().strip('"'); break
    return {
        "serial_number": serial,
        "brand":         brand,
        "model":         model,
        "processor":     cpu,
        "ram":           ram_gb,
        "storage":       storage,
        "os_name":       os_name,
        "os_version":    os_version,
    }


# ── unified collection ──────────────────────────────────────────────────────
def collect_system_info() -> dict:
    hostname  = socket.gethostname()
    logged_in = os.environ.get("USERNAME") or os.environ.get("USER") or ""

    ip_addr = ""
    try:
        # Connect to a public IP to find the outbound interface (no packet sent).
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip_addr = s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        try:
            ip_addr = socket.gethostbyname(hostname)
        except Exception:
            pass

    mac_addr = ""
    try:
        n = uuid.getnode()
        mac_addr = ":".join(f"{(n >> i) & 0xff:02x}" for i in range(40, -1, -8))
    except Exception:
        pass

    if IS_WIN:
        per_os = _collect_windows()
    elif IS_MAC:
        per_os = _collect_macos()
    elif IS_LIN:
        per_os = _collect_linux()
    else:
        per_os = {
            "serial_number": "", "brand": "", "model": "", "processor": "",
            "ram": "", "storage": "", "os_name": platform.system(),
            "os_version": platform.version(),
        }

    return {
        **per_os,
        "hostname":            hostname,
        "logged_in_username":  logged_in,
        "employee_email":      EMPLOYEE_EMAIL,
        "employee_ecode":      EMPLOYEE_ECODE,
        "ip_address":          ip_addr,
        "mac_address":         mac_addr,
        "agent_version":       AGENT_VERSION,
    }


# ── HTTP helpers ─────────────────────────────────────────────────────────────
def _headers() -> dict:
    return {
        "X-Agent-Token": TOKEN,
        "Content-Type":  "application/json",
        "User-Agent":    f"miles-agent/{AGENT_VERSION} ({platform.system()})",
    }


def _post(path: str, body: dict) -> dict:
    r = requests.post(f"{API_BASE}{path}", json=body, headers=_headers(), timeout=HTTP_TIMEOUT_SEC)
    try:
        return r.json()
    except Exception:
        return {"success": False, "error": f"http {r.status_code}: {r.text[:200]}"}


def _get(path: str) -> dict:
    r = requests.get(f"{API_BASE}{path}", headers=_headers(), timeout=HTTP_TIMEOUT_SEC)
    try:
        return r.json()
    except Exception:
        return {"success": False, "error": f"http {r.status_code}: {r.text[:200]}"}


# ── wallpaper (cross-platform) ──────────────────────────────────────────────
def _screen_size() -> tuple[int, int]:
    """Best-effort current primary-display resolution. Defaults to 1920x1080."""
    try:
        if IS_WIN:
            import ctypes
            user32 = ctypes.windll.user32
            try: user32.SetProcessDPIAware()
            except Exception: pass
            return (user32.GetSystemMetrics(0), user32.GetSystemMetrics(1))
        if IS_MAC:
            out = subprocess.check_output(
                ["system_profiler", "SPDisplaysDataType"], timeout=10
            ).decode(errors="ignore")
            import re
            m = re.search(r"Resolution:\s+(\d+)\s*x\s*(\d+)", out)
            if m: return (int(m.group(1)), int(m.group(2)))
        if IS_LIN and shutil.which("xrandr"):
            out = subprocess.check_output(["xrandr", "--current"], timeout=10).decode(errors="ignore")
            import re
            for line in out.splitlines():
                m = re.search(r"\s(\d+)x(\d+)\+\d+\+\d+", line)
                if m: return (int(m.group(1)), int(m.group(2)))
    except Exception:
        pass
    return (1920, 1080)


def pick_variant(variants: list, screen_w: int, screen_h: int) -> dict | None:
    """Choose the smallest variant that fully covers the screen.
    If none cover it, fall back to the largest available (avoids upscaling artefacts)."""
    if not variants: return None
    covering = [v for v in variants if v.get("width", 0) >= screen_w and v.get("height", 0) >= screen_h]
    if covering:
        return min(covering, key=lambda v: v["width"] * v["height"])
    return max(variants, key=lambda v: v.get("width", 0) * v.get("height", 0))


def _win_set_style_fill() -> None:
    """Write HKCU\\Control Panel\\Desktop\\WallpaperStyle=10 (Fill) + TileWallpaper=0."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop",
                            0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "WallpaperStyle", 0, winreg.REG_SZ, "10")  # 10 = Fill
            winreg.SetValueEx(k, "TileWallpaper",  0, winreg.REG_SZ, "0")
    except Exception:
        pass  # registry write is best-effort; SetDeskWallpaper still works


def _set_wallpaper(local_path: str) -> tuple[bool, str | None]:
    try:
        if IS_WIN:
            import ctypes
            _win_set_style_fill()
            # SPI_SETDESKWALLPAPER=20, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE=3
            ok = ctypes.windll.user32.SystemParametersInfoW(20, 0, local_path, 3)
            return (bool(ok), None if ok else "SystemParametersInfoW returned 0")
        if IS_MAC:
            # macOS Sonoma (14) / Sequoia (15+) overhauled wallpaper storage. The
            # classic `osascript ... set picture of every desktop` updates the
            # legacy store that the LOCK SCREEN reads, but frequently does NOT
            # refresh the LIVE DESKTOP. The reliable way to update the desktop on
            # modern macOS is NSWorkspace.setDesktopImageURL, applied to every
            # screen, with a reset-to-empty first to defeat the "same path, new
            # contents" cache bug. We do BOTH the NSWorkspace call and the legacy
            # AppleScript so the lock screen and every display update together.
            esc = local_path.replace("\\", "\\\\").replace('"', '\\"')
            try:
                mac_major = int((platform.mac_ver()[0] or "0").split(".")[0])
            except Exception:  # noqa: BLE001
                mac_major = 0

            # 1) Primary: NSWorkspace via the built-in Swift interpreter, which
            #    actually re-renders the LIVE DESKTOP on all displays. This is the
            #    authoritative "desktop applied" signal — the Swift program exits
            #    nonzero if any screen fails or there is no GUI session, so we never
            #    report a false success. Swift ships with the Command Line Tools
            #    that python3 already needs; if it is missing we fall through to the
            #    legacy AppleScript path below.
            swift_src = (
                "import AppKit\n"
                f'let u = URL(fileURLWithPath: "{esc}")\n'
                "let screens = NSScreen.screens\n"
                "if screens.isEmpty {\n"
                '  FileHandle.standardError.write("no GUI screens\\n".data(using: .utf8)!)\n'
                "  exit(3)\n"
                "}\n"
                "var failed = false\n"
                "for s in screens {\n"
                "  try? NSWorkspace.shared.setDesktopImageURL(URL(fileURLWithPath: \"\"), for: s, options: [:])\n"
                "  do {\n"
                "    try NSWorkspace.shared.setDesktopImageURL(u, for: s, options: [:])\n"
                "  } catch {\n"
                '    failed = true\n'
                '    FileHandle.standardError.write("setDesktopImageURL failed: \\(error)\\n".data(using: .utf8)!)\n'
                "  }\n"
                "}\n"
                "exit(failed ? 1 : 0)\n"
            )
            desktop_ok = False
            swift_err: str | None = None
            tmp_path: str | None = None
            try:
                with tempfile.NamedTemporaryFile("w", suffix=".swift", delete=False) as tmp:
                    tmp.write(swift_src)
                    tmp_path = tmp.name
                subprocess.check_call(["swift", tmp_path], timeout=60,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                desktop_ok = True
            except FileNotFoundError:
                swift_err = "swift (Command Line Tools) not available"
            except subprocess.CalledProcessError as e:
                swift_err = (e.stderr.decode() if e.stderr else str(e)).strip() or "swift exited nonzero"
            except Exception as e:  # noqa: BLE001
                swift_err = str(e)
            finally:
                if tmp_path:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

            # 2) Also drive the legacy AppleScript path so the LOCK SCREEN / login
            #    window and pre-Sonoma releases are covered.
            legacy_ok = False
            legacy_err: str | None = None
            for script in (
                f'tell application "System Events" to set picture of every desktop to "{esc}"',
                f'tell application "Finder" to set desktop picture to POSIX file "{esc}"',
            ):
                try:
                    subprocess.check_call(["osascript", "-e", script], timeout=20,
                                          stderr=subprocess.PIPE)
                    legacy_ok = True
                except subprocess.CalledProcessError as e:
                    legacy_err = (e.stderr.decode() if e.stderr else str(e)).strip()
                except Exception as e:  # noqa: BLE001
                    legacy_err = str(e)

            if not (desktop_ok or legacy_ok):
                return (False, swift_err or legacy_err or "failed to set wallpaper on macOS")

            # Force an immediate re-render of the desktop + lock screen.
            for proc in ("Dock", "WallpaperAgent"):
                try:
                    subprocess.call(["killall", proc], timeout=10,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:  # noqa: BLE001
                    pass

            # Best-effort read-back: does the live desktop now reference our file?
            verified: bool | None = None
            try:
                out = subprocess.check_output(
                    ["osascript", "-e",
                     'tell application "System Events" to get picture of desktop 1'],
                    timeout=15, stderr=subprocess.DEVNULL,
                ).decode().strip()
                verified = (
                    os.path.abspath(local_path) == out
                    or os.path.basename(local_path) in out
                )
            except Exception:  # noqa: BLE001 — verification unavailable
                verified = None

            # Decide honestly. NSWorkspace success means the desktop was updated on
            # every display; a positive read-back independently confirms it.
            if desktop_ok or verified:
                return (True, None)
            # On Sonoma+ (macOS 14+) the legacy AppleScript path alone typically
            # updates only the lock screen, not the live desktop — report that
            # truthfully instead of a false "applied".
            if mac_major >= 14:
                return (False, swift_err or
                        "lock screen updated but live desktop did not change "
                        "(NSWorkspace unavailable on macOS 14+)")
            # Older macOS: the legacy AppleScript path does update the desktop.
            return (True, None)
        if IS_LIN:
            if shutil.which("gsettings"):
                subprocess.check_call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-uri", f"file://{local_path}",
                ], timeout=15)
                subprocess.call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-uri-dark", f"file://{local_path}",
                ], timeout=15)
                # Fill the screen (image is already pre-composited at full-screen size)
                subprocess.call([
                    "gsettings", "set", "org.gnome.desktop.background",
                    "picture-options", "zoom",
                ], timeout=15)
                return (True, None)
            return (False, "no supported desktop env (gsettings missing)")
        return (False, f"unsupported platform: {sys.platform}")
    except Exception as e:
        return (False, str(e))


def _wallpaper_cache_dir() -> str:
    if IS_WIN:
        base = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "MilesAgent")
    elif IS_MAC:
        base = os.path.expanduser("~/Library/Application Support/MilesAgent")
    else:
        base = os.path.expanduser("~/.cache/miles-agent")
    os.makedirs(base, exist_ok=True)
    return base


def _wallpaper_state_path() -> str:
    return os.path.join(_wallpaper_cache_dir(), "wallpaper.state.json")


def _wallpaper_image_path(ext: str = "png") -> str:
    return os.path.join(_wallpaper_cache_dir(), f"miles_wallpaper.{ext}")


def _load_wallpaper_state() -> dict:
    try:
        with open(_wallpaper_state_path()) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _save_wallpaper_state(d: dict) -> None:
    try:
        with open(_wallpaper_state_path(), "w") as fh:
            json.dump(d, fh)
    except Exception:
        pass


def apply_active_wallpaper(force: bool = False) -> tuple[str, str | None]:
    """Fetch active wallpaper from portal, download if changed, apply, and report.
    Returns (status, error). Status is 'applied' | 'skipped' | 'failed' | 'none'.
    Never raises — wallpaper failure must not break the sync loop.
    """
    try:
        resp = _get("/wallpaper/active")
        if not resp.get("success"):
            return ("failed", resp.get("error") or "fetch failed")
        w = resp.get("wallpaper")
        if not w:
            return ("none", None)

        wid    = w.get("id")
        # Pick the right-sized variant for THIS screen (preserves quality, avoids stretching)
        variants = w.get("variants") or []
        screen_w, screen_h = _screen_size()
        chosen = pick_variant(variants, screen_w, screen_h) if variants else None
        if chosen:
            url  = chosen["url"]
            sha  = chosen.get("sha256") or ""
            mime = "image/png"  # variants are PNG/JPG; ext determined below
        else:
            url  = w.get("url")
            sha  = w.get("sha256") or ""
            mime = (w.get("mime_type") or "").lower()
        ext    = "jpg" if "jpeg" in mime or "jpg" in mime else ("bmp" if "bmp" in mime else "png")
        # URL hint: if URL ends with .jpg/.png prefer that
        for e in ("jpg", "jpeg", "png", "bmp"):
            if url.lower().endswith("." + e):
                ext = "jpg" if e == "jpeg" else e
                break
        dst    = _wallpaper_image_path(ext)

        state  = _load_wallpaper_state()
        same   = (state.get("sha256") == sha and state.get("wallpaper_id") == wid
                  and os.path.exists(state.get("path", "")))

        if same and not force:
            return ("skipped", None)

        # Download (stream to avoid huge memory for large images)
        r = requests.get(url, timeout=HTTP_TIMEOUT_SEC, stream=True)
        if r.status_code != 200:
            err = f"download http {r.status_code}"
            _post("/wallpaper/status", {"wallpaper_id": wid, "status": "failed", "error": err})
            return ("failed", err)

        with open(dst, "wb") as f:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                if chunk: f.write(chunk)

        # Verify hash if server supplied one (preserves quality / integrity)
        if sha:
            h = hashlib.sha256()
            with open(dst, "rb") as f:
                for chunk in iter(lambda: f.read(64 * 1024), b""):
                    h.update(chunk)
            if h.hexdigest() != sha:
                err = "sha256 mismatch — file corrupted in transit"
                _post("/wallpaper/status", {"wallpaper_id": wid, "status": "failed", "error": err})
                return ("failed", err)

        ok, err = _set_wallpaper(os.path.abspath(dst))
        status  = "applied" if ok else "failed"
        _post("/wallpaper/status", {
            "wallpaper_id": wid, "status": status, "error": err,
        })
        if ok:
            _save_wallpaper_state({
                "wallpaper_id": wid, "sha256": sha, "path": dst,
                "applied_at": datetime.now(timezone.utc).isoformat(),
            })
        return (status, err)
    except Exception as e:
        try: _post("/wallpaper/status", {"status": "failed", "error": str(e)})
        except Exception: pass
        return ("failed", str(e))


# ── commands ────────────────────────────────────────────────────────────────
def execute_command(cmd: dict) -> tuple[str, str | None, str | None]:
    """Returns (status, result_message, error_message)."""
    ctype = cmd.get("type")
    if ctype in ("sync_now", "collect_system_info"):
        _post("/sync", {"payload": collect_system_info()})
        return ("completed", "synced", None)
    if ctype == "update_wallpaper":
        # Always pull the current active wallpaper from the portal (force re-apply)
        status, err = apply_active_wallpaper(force=True)
        if status in ("applied", "skipped"):
            return ("completed", f"wallpaper {status}", None)
        if status == "none":
            return ("completed", "no active wallpaper", None)
        return ("failed", None, err)
    return ("failed", None, f"unsupported command: {ctype}")


def poll_commands() -> None:
    resp = _get("/commands")
    if not resp.get("success"):
        return
    for cmd in resp.get("commands", []):
        status, result, err = execute_command(cmd)
        _post("/commands/status", {
            "id":     cmd["id"],
            "status": status,
            "result": result,
            "error":  err,
        })


# ── entrypoints ─────────────────────────────────────────────────────────────
def register() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    print(json.dumps(_post("/register", {"payload": collect_system_info()}), indent=2))
    # First-run wallpaper apply (best-effort, never blocks registration success)
    status, err = apply_active_wallpaper(force=True)
    if status == "applied": print("[wallpaper] applied")
    elif status == "skipped": print("[wallpaper] already up-to-date")
    elif status == "none":    print("[wallpaper] none configured")
    else:                     print(f"[wallpaper] {status}: {err}", file=sys.stderr)
    return 0


def run_loop() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    while True:
        try:
            _post("/sync", {"payload": collect_system_info()})
            apply_active_wallpaper()   # post-sync wallpaper check (no-op if unchanged)
            poll_commands()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] sync error: {e}", file=sys.stderr)
        time.sleep(SYNC_INTERVAL_SEC)


# ── service install (auto-start after reboot) ───────────────────────────────
MAC_PLIST_LABEL = "com.miles.agent"
MAC_PLIST_PATH  = os.path.expanduser(f"~/Library/LaunchAgents/{MAC_PLIST_LABEL}.plist")
MAC_INSTALL_DIR = os.path.expanduser("~/Library/Application Support/MilesAgent")
MAC_LOG_OUT     = os.path.expanduser("~/Library/Logs/miles-agent.out.log")
MAC_LOG_ERR     = os.path.expanduser("~/Library/Logs/miles-agent.err.log")


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def install_service_mac() -> int:
    """Install a per-user launchd agent that runs `miles-agent run` and survives reboot."""
    return _install_service_mac_impl()


def _service_program_args(install_dir: str) -> tuple[list[str], str]:
    """Return the argv used to launch the agent in `run` mode as a persistent service,
    plus a display path. Handles both frozen-binary and plain .py script installs so the
    service keeps working whether the user ran the binary or `python3 laptop_agent.py`."""
    src = os.path.abspath(sys.argv[0])
    if getattr(sys, "frozen", False):
        # PyInstaller binary — exec it directly.
        dst = os.path.join(install_dir, "miles-agent")
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copy2(src, dst)
        os.chmod(dst, 0o755)
        return ([dst, "run"], dst)
    # Script mode — copy the .py to a stable location and launch via the current interpreter
    # (e.g. a venv python that has `requests`), so the service uses the same env that worked.
    dst = os.path.join(install_dir, "laptop_agent.py")
    if os.path.abspath(src) != os.path.abspath(dst):
        shutil.copy2(src, dst)
    os.chmod(dst, 0o644)
    return ([os.path.abspath(sys.executable), dst, "run"], dst)


def _install_service_mac_impl() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    os.makedirs(MAC_INSTALL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MAC_PLIST_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(MAC_LOG_OUT), exist_ok=True)

    # Build launch argv (handles both frozen binary and plain .py script installs).
    prog_args, dst = _service_program_args(MAC_INSTALL_DIR)
    prog_xml = "\n".join(f"    <string>{_xml_escape(a)}</string>" for a in prog_args)

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{MAC_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{prog_xml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MILES_AGENT_TOKEN</key><string>{_xml_escape(TOKEN)}</string>
    <key>MILES_AGENT_API_BASE</key><string>{_xml_escape(API_BASE)}</string>
    <key>MILES_AGENT_SYNC_INTERVAL</key><string>{SYNC_INTERVAL_SEC}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{_xml_escape(MAC_LOG_OUT)}</string>
  <key>StandardErrorPath</key><string>{_xml_escape(MAC_LOG_ERR)}</string>
</dict>
</plist>
"""
    with open(MAC_PLIST_PATH, "w") as fh:
        fh.write(plist)
    os.chmod(MAC_PLIST_PATH, 0o644)

    # Reload (unload-then-load; ignore "Could not find specified service")
    subprocess.run(["launchctl", "unload", MAC_PLIST_PATH],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    r = subprocess.run(["launchctl", "load", "-w", MAC_PLIST_PATH],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        print("ERROR: launchctl load failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
        return 1

    print(f"✓ Service '{MAC_PLIST_LABEL}' installed and started.")
    print(f"  Binary:   {dst}")
    print(f"  Plist:    {MAC_PLIST_PATH}")
    print(f"  Logs:     {MAC_LOG_OUT}")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds (auto-starts on login)")
    return 0


def uninstall_service_mac() -> int:
    if os.path.exists(MAC_PLIST_PATH):
        subprocess.run(["launchctl", "unload", MAC_PLIST_PATH],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(MAC_PLIST_PATH)
    if os.path.isdir(MAC_INSTALL_DIR):
        shutil.rmtree(MAC_INSTALL_DIR, ignore_errors=True)
    print("✓ Service uninstalled.")
    return 0


# ── Linux systemd --user service ────────────────────────────────────────────
LIN_UNIT_NAME   = "miles-agent.service"
LIN_UNIT_PATH   = os.path.expanduser(f"~/.config/systemd/user/{LIN_UNIT_NAME}")
LIN_INSTALL_DIR = os.path.expanduser("~/.local/share/miles-agent")


def install_service_linux() -> int:
    """Install a systemd --user service that runs the agent and survives reboot (with linger)."""
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    os.makedirs(LIN_INSTALL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(LIN_UNIT_PATH), exist_ok=True)

    # Build launch argv (handles both frozen binary and plain .py script installs).
    prog_args, dst = _service_program_args(LIN_INSTALL_DIR)
    exec_start = " ".join(shlex.quote(a) for a in prog_args)

    unit = f"""[Unit]
Description=Miles IT Assets Device Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=always
RestartSec=15
Environment=MILES_AGENT_TOKEN={TOKEN}
Environment=MILES_AGENT_API_BASE={API_BASE}
Environment=MILES_AGENT_SYNC_INTERVAL={SYNC_INTERVAL_SEC}

[Install]
WantedBy=default.target
"""
    with open(LIN_UNIT_PATH, "w") as fh:
        fh.write(unit)
    os.chmod(LIN_UNIT_PATH, 0o600)  # contains token

    for args in (
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", LIN_UNIT_NAME],
        ["systemctl", "--user", "restart", LIN_UNIT_NAME],
    ):
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            print(f"ERROR: {' '.join(args)} failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
            return 1

    print(f"✓ Service '{LIN_UNIT_NAME}' installed and started (systemd --user).")
    print(f"  Binary:   {dst}")
    print(f"  Unit:     {LIN_UNIT_PATH}")
    print(f"  Status:   systemctl --user status {LIN_UNIT_NAME}")
    print(f"  Logs:     journalctl --user -u {LIN_UNIT_NAME} -f")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds")
    print()
    print("To keep the agent running when you are logged out (headless servers), run once:")
    print(f"  sudo loginctl enable-linger {os.environ.get('USER', '$USER')}")
    return 0


def uninstall_service_linux() -> int:
    subprocess.run(["systemctl", "--user", "disable", "--now", LIN_UNIT_NAME],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.exists(LIN_UNIT_PATH):
        os.remove(LIN_UNIT_PATH)
    subprocess.run(["systemctl", "--user", "daemon-reload"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.isdir(LIN_INSTALL_DIR):
        shutil.rmtree(LIN_INSTALL_DIR, ignore_errors=True)
    print("✓ Service uninstalled.")
    return 0


def install_service() -> int:
    if IS_MAC:  return install_service_mac()
    if IS_LIN:  return install_service_linux()
    if IS_WIN:  print("Windows: use Task Scheduler or run `miles-agent.exe run` from a startup script.", file=sys.stderr); return 2
    print("Unsupported platform for service install.", file=sys.stderr); return 2


def uninstall_service() -> int:
    if IS_MAC: return uninstall_service_mac()
    if IS_LIN: return uninstall_service_linux()
    print("Service uninstall not implemented for this platform.", file=sys.stderr); return 2


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "register": return register()
    if cmd == "sync":
        print(json.dumps(_post("/sync", {"payload": collect_system_info()}), indent=2)); return 0
    if cmd == "info":
        print(json.dumps(collect_system_info(), indent=2)); return 0
    if cmd == "run":               return run_loop()
    if cmd == "install-service":   return install_service()
    if cmd == "uninstall-service": return uninstall_service()
    print(f"unknown command: {cmd}", file=sys.stderr); return 2


if __name__ == "__main__":
    sys.exit(main())
