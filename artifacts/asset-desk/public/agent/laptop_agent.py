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
import threading
from datetime import datetime, timezone

import requests

AGENT_VERSION       = "0.6.1"
DEFAULT_API_BASE    = "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/agent-api"
API_BASE            = os.environ.get("MILES_AGENT_API_BASE", DEFAULT_API_BASE)
SYNC_INTERVAL_SEC   = int(os.environ.get("MILES_AGENT_SYNC_INTERVAL", "300"))  # 5 min
# Commands (lock / unlock / etc.) are polled far more frequently than the heavy
# system sync so admin actions take effect within seconds, not minutes.
COMMAND_POLL_SEC    = max(2, int(os.environ.get("MILES_AGENT_COMMAND_POLL", "5")))
HTTP_TIMEOUT_SEC    = 30

EMPLOYEE_EMAIL      = os.environ.get("MILES_EMPLOYEE_EMAIL", "")
EMPLOYEE_ECODE      = os.environ.get("MILES_EMPLOYEE_ECODE", "")

IS_WIN  = sys.platform.startswith("win")
IS_MAC  = sys.platform == "darwin"
IS_LIN  = sys.platform.startswith("linux")

# On Windows the agent runs windowless (pythonw via the Startup launcher), but
# every child process we spawn — powershell, wmic, etc. — would otherwise pop up
# its own console window. collect_system_info() runs these on every /sync poll,
# so without this flag a PowerShell/cmd window flashes on the user's screen
# repeatedly. CREATE_NO_WINDOW keeps those children windowless. 0 on non-Windows.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WIN else 0

# The macOS root LaunchDaemon must NOT carry the auth token in its world-readable
# plist (any local user could read it and forge command status). Instead the token
# is written to this root-only (0600) file at install time and read back here.
MAC_SYS_TOKEN_FILE = "/Library/Application Support/MilesAgent/agent.token"


def _load_token() -> str:
    t = os.environ.get("MILES_AGENT_TOKEN", "")
    if t:
        return t.strip()
    if IS_MAC:
        try:
            with open(MAC_SYS_TOKEN_FILE) as fh:
                return fh.read().strip()
        except OSError:
            pass
    return ""


TOKEN = _load_token()


# ── shell helper ────────────────────────────────────────────────────────────
def _run(cmd: list[str], timeout: int = 15) -> str:
    """Run a command and return stripped stdout. Empty string on any failure.
    Spawns children windowless on Windows (see _NO_WINDOW) so polling never
    flashes a PowerShell/cmd console on the user's screen."""
    try:
        out = subprocess.check_output(
            cmd, stderr=subprocess.DEVNULL, timeout=timeout,
            creationflags=_NO_WINDOW,
        )
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
def _uptime_seconds() -> int | None:
    """Seconds since the machine last booted. None if it can't be determined."""
    try:
        if IS_WIN:
            import ctypes
            # GetTickCount64 = ms since boot (monotonic, unaffected by clock changes).
            ms = ctypes.windll.kernel32.GetTickCount64()
            return int(ms // 1000)
        if IS_LIN:
            with open("/proc/uptime", "r") as fh:
                return int(float(fh.read().split()[0]))
        if IS_MAC:
            # kern.boottime → "{ sec = 1700000000, usec = 0 } ..."
            r = subprocess.run(["sysctl", "-n", "kern.boottime"],
                               capture_output=True, text=True, timeout=10)
            import re
            m = re.search(r"sec\s*=\s*(\d+)", r.stdout)
            if m:
                return max(0, int(time.time()) - int(m.group(1)))
    except Exception:
        pass
    return None


def _boot_time_iso() -> str | None:
    """ISO8601 (UTC) timestamp of the last boot, derived from uptime."""
    up = _uptime_seconds()
    if up is None:
        return None
    try:
        from datetime import timedelta
        return (datetime.now(timezone.utc) - timedelta(seconds=up)).isoformat()
    except Exception:
        return None


def collect_system_info() -> dict:
    hostname  = socket.gethostname()
    logged_in = os.environ.get("USERNAME") or os.environ.get("USER") or ""
    # When the agent runs as a root system service (required for Linux hard lock),
    # USER/USERNAME is "root". Report the real human at the console instead so the
    # portal keeps showing the employee, not the service account.
    if IS_LIN and _is_root():
        cu = _linux_console_user()
        if cu:
            logged_in = cu
    if IS_MAC and _is_root():
        cu = _mac_console_user()
        if cu:
            logged_in = cu

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
        "uptime_seconds":      _uptime_seconds(),
        "last_boot_at":        _boot_time_iso(),
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


def _win_set_lockscreen(local_path: str) -> tuple[bool, str | None]:
    """Set the CURRENT USER's lock-screen image — no admin required.

    SystemParametersInfo only changes the desktop, never the lock screen. The
    only reliable per-user (non-admin) way to set the lock screen on Win 10/11
    is the WinRT API Windows.System.UserProfile.LockScreen.SetImageFileAsync,
    which we drive from in-box PowerShell 5.1. The image is read from the user's
    own LOCALAPPDATA, so it works while the agent runs in the user session.

    Returns (ok, error). Common failure: a Group Policy that forces/locks the
    lock-screen image throws "Access is denied" — reported, never raised.
    """
    # Single-quote the path for PowerShell, doubling any embedded single quotes.
    ps_path = local_path.replace("'", "''")
    snippet = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null;"
        "$null=[Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime];"
        "$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime];"
        "$gen=([System.WindowsRuntimeSystemExtensions].GetMethods()|"
        "Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and "
        "$_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0];"
        "$act=([System.WindowsRuntimeSystemExtensions].GetMethods()|"
        "Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod})[0];"
        "function Await($op,$t){$m=$gen.MakeGenericMethod($t);$tk=$m.Invoke($null,@($op));$tk.Wait(-1)|Out-Null;$tk.Result};"
        "function AwaitAction($a){$tk=$act.Invoke($null,@($a));$tk.Wait(-1)|Out-Null};"
        f"$f=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('{ps_path}')) ([Windows.Storage.StorageFile]);"
        "AwaitAction ([Windows.System.UserProfile.LockScreen]::SetImageFileAsync($f));"
        "Write-Output 'OK'"
    )
    try:
        kwargs: dict = {}
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", snippet],
            capture_output=True, text=True, timeout=45, **kwargs,
        )
        if r.returncode == 0 and "OK" in (r.stdout or ""):
            return (True, None)
        err = (r.stderr or r.stdout or "").strip().replace("\r", " ").replace("\n", " ")
        return (False, (err[:300] or f"powershell exit {r.returncode}"))
    except Exception as e:
        return (False, str(e))


def _set_wallpaper(local_path: str) -> tuple[bool, str | None]:
    try:
        if IS_WIN:
            import ctypes
            _win_set_style_fill()
            # SPI_SETDESKWALLPAPER=20, SPIF_UPDATEINIFILE|SPIF_SENDWININICHANGE=3
            ok = bool(ctypes.windll.user32.SystemParametersInfoW(20, 0, local_path, 3))
            if not ok:
                return (False, "SystemParametersInfoW returned 0")
            # Desktop set — now also set the lock screen (separate subsystem;
            # SPI never touches it). Best-effort, per-user, no admin.
            lock_ok, lock_err = _win_set_lockscreen(local_path)
            if not lock_ok:
                # Desktop succeeded; surface the lock-screen problem without
                # failing the whole apply (e.g. policy-locked lock screens).
                return (True, f"desktop applied; lock screen not set: {lock_err}")
            return (True, None)
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
                # When root, the swift program runs as the console user (see
                # _mac_gui_argv) and must be able to read this temp file.
                try:
                    os.chmod(tmp_path, 0o644)
                except OSError:
                    pass
                subprocess.check_call(_mac_gui_argv(["swift", tmp_path]), timeout=60,
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
                    subprocess.check_call(_mac_gui_argv(["osascript", "-e", script]), timeout=20,
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
                    subprocess.call(_mac_gui_argv(["killall", proc]), timeout=10,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:  # noqa: BLE001
                    pass

            # Best-effort read-back: does the live desktop now reference our file?
            verified: bool | None = None
            try:
                out = subprocess.check_output(
                    _mac_gui_argv(["osascript", "-e",
                     'tell application "System Events" to get picture of desktop 1']),
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
        if _is_root():
            # The agent runs as a root LaunchDaemon, but the wallpaper is applied
            # inside the console user's GUI session — which cannot read root's home
            # (/var/root). Stage the image in a world-readable shared location.
            base = "/Users/Shared/MilesAgent"
        else:
            base = os.path.expanduser("~/Library/Application Support/MilesAgent")
    else:
        base = os.path.expanduser("~/.cache/miles-agent")
    os.makedirs(base, exist_ok=True)
    if IS_MAC and _is_root():
        try:
            os.chmod(base, 0o755)
        except OSError:
            pass
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
        if IS_MAC and _is_root():
            # The wallpaper is applied inside the console user's GUI session, which
            # must be able to read this file (root's umask would otherwise make it 0600).
            try:
                os.chmod(dst, 0o644)
            except OSError:
                pass

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


# ── remote HARD lock (real OS lockout, honest reporting) ───────────────────
# A locked device is locked at the OS level — NOT a dismissable overlay:
#   * Windows : LockWorkStation() drops to the secure desktop. This is dismissed
#               the instant the user types their password, so we RE-ASSERT it
#               every fast cycle (see reassert_lock) to keep them out.
#   * macOS   : the account is DISABLED (pwpolicy/DisabledUser) and the user is
#               dropped to the login window, where a custom banner tells them to
#               contact IT. Their password is rejected — a genuine login-window
#               lock, not a screen saver. Needs root (system LaunchDaemon).
#   * Linux   : the account is password-locked (usermod -L) and the active
#               session is terminated. Needs root (system service).
# macOS/Linux use a PERSISTENT account lock, so they need no re-assertion. On
# macOS/Linux, if the agent is NOT root we report "requires_admin" (reinstall
# with sudo) rather than faking success.
# We NEVER report 'completed' unless the OS lock actually took effect, and we
# surface the exact failure reason to the portal. Local state persists so the
# lock re-applies on reboot and is reconciled from the server every /sync.
LOCK_STATE_FILE = os.path.join(os.path.expanduser("~"), ".miles-agent", "lock.state.json")

_lock_mutex = threading.Lock()


def _read_lock_state() -> dict:
    try:
        with open(LOCK_STATE_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _read_local_lock() -> bool:
    return bool(_read_lock_state().get("locked", False))


def _write_lock_state(state: dict) -> None:
    try:
        os.makedirs(os.path.dirname(LOCK_STATE_FILE), exist_ok=True)
        with open(LOCK_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass


def _is_root() -> bool:
    try:
        return hasattr(os, "geteuid") and os.geteuid() == 0
    except Exception:
        return False


# ── macOS hard-lock helpers ───────────────────────────────────────────────────
# The login-window banner shown to a locked-out user. Set via
# `defaults write /Library/Preferences/com.apple.loginwindow LoginwindowText`.
MAC_LOCK_MESSAGE = "This device is managed by Miles Education. Please contact IT Admin."


def _mac_console_user() -> str | None:
    """The human currently logged into the GUI (Aqua) session, or None when the
    Mac is sitting at the login window. Reads the owner of /dev/console, which is
    the console user; falls back to SystemConfiguration. System/service accounts
    (root, _windowserver, loginwindow, names starting with '_') are ignored."""
    def _is_human(name: str | None) -> bool:
        return bool(name) and name not in ("root", "loginwindow", "_windowserver") \
            and not name.startswith("_")
    try:
        out = subprocess.run(["stat", "-f", "%Su", "/dev/console"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if _is_human(out):
            return out
    except Exception:
        pass
    try:
        out = subprocess.run(["scutil"], input="show State:/Users/ConsoleUser\n",
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            if "Name :" in line:
                name = line.split(":", 1)[1].strip()
                if _is_human(name):
                    return name
    except Exception:
        pass
    return None


def _mac_uid_for(user: str) -> int | None:
    try:
        import pwd
        return pwd.getpwnam(user).pw_uid
    except Exception:
        return None


def _mac_console_uid() -> int | None:
    u = _mac_console_user()
    return _mac_uid_for(u) if u else None


def _mac_human_users() -> list[str]:
    """All local human accounts (UID >= 500, name not starting with '_'). Used to
    pick a lock target when nobody is at the console (e.g. lost/stolen at the
    login window)."""
    users: list[str] = []
    try:
        out = subprocess.run(["dscl", ".", "-list", "/Users", "UniqueID"],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                name, uid = parts[0], int(parts[1])
                if uid >= 500 and name != "root" and not name.startswith("_"):
                    users.append(name)
    except Exception:
        pass
    return users


def _mac_gui_argv(argv: list[str]) -> list[str]:
    """Wrap argv so it executes inside the console user's Aqua GUI session when the
    agent runs as root (a LaunchDaemon). NSWorkspace / osascript / killall must run
    in the user's session, not the bare root daemon context, or they no-op. When the
    agent is not root (legacy per-user LaunchAgent) the argv runs unchanged."""
    if IS_MAC and _is_root():
        uid = _mac_console_uid()
        user = _mac_console_user()
        if uid is not None and user:
            return ["launchctl", "asuser", str(uid), "sudo", "-u", user, *argv]
    return argv


def _mac_account_disabled(user: str) -> bool | None:
    """Whether `user` is barred from logging in. Deterministic check via the
    account's AuthenticationAuthority (contains ';DisabledUser;' when disabled),
    with pwpolicy as a secondary signal. Returns True/False, or None if it cannot
    be determined (so we never report a false 'locked')."""
    try:
        r = subprocess.run(["dscl", ".", "-read", f"/Users/{user}", "AuthenticationAuthority"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            if "DisabledUser" in r.stdout:
                return True
            # We could read the record and it is not disabled — unless pwpolicy
            # says otherwise below.
            authoritative_false = True
        else:
            authoritative_false = False
    except Exception:
        authoritative_false = False
    try:
        r = subprocess.run(["pwpolicy", "-u", user, "-getpolicy"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            blob = r.stdout.replace(" ", "").lower()
            if "isdisabled=1" in blob or "isdisabled=true" in blob:
                return True
            return False
    except Exception:
        pass
    return False if authoritative_false else None


def _mac_disable_account(user: str) -> tuple[bool, str]:
    """Bar `user` from logging in. Tries pwpolicy then a direct DisabledUser
    authority append, verifying after each. Returns (ok, detail) where ok is True
    only when the account is CONFIRMED disabled."""
    subprocess.run(["pwpolicy", "-u", user, "-disableuser"],
                   capture_output=True, text=True, timeout=15)
    if _mac_account_disabled(user) is True:
        return (True, "pwpolicy -disableuser")
    subprocess.run(["dscl", ".", "-append", f"/Users/{user}",
                    "AuthenticationAuthority", ";DisabledUser;"],
                   capture_output=True, text=True, timeout=15)
    if _mac_account_disabled(user) is True:
        return (True, "dscl DisabledUser")
    return (False, "account could not be disabled (verification failed)")


def _mac_enable_account(user: str) -> tuple[bool, str]:
    """Re-enable `user`. Uses both pwpolicy and DisabledUser removal, then
    verifies. Returns (ok, detail); ok True only when CONFIRMED not disabled."""
    subprocess.run(["pwpolicy", "-u", user, "-enableuser"],
                   capture_output=True, text=True, timeout=15)
    subprocess.run(["dscl", ".", "-delete", f"/Users/{user}",
                    "AuthenticationAuthority", ";DisabledUser;"],
                   capture_output=True, text=True, timeout=15)
    state = _mac_account_disabled(user)
    if state is False:
        return (True, "account re-enabled")
    if state is None:
        return (False, "re-enable attempted but could not be verified")
    return (False, "account is still disabled after re-enable")


def _mac_set_login_message(msg: str) -> bool:
    """Show a banner on the login window. Root-only. Returns True only if the
    banner was written AND read back identically, so the caller can report an
    honest status instead of assuming the banner is showing."""
    try:
        subprocess.run(["defaults", "write",
                        "/Library/Preferences/com.apple.loginwindow",
                        "LoginwindowText", msg],
                       capture_output=True, text=True, timeout=10)
        out = subprocess.run(["defaults", "read",
                              "/Library/Preferences/com.apple.loginwindow",
                              "LoginwindowText"],
                             capture_output=True, text=True, timeout=10)
        return out.returncode == 0 and out.stdout.strip() == msg.strip()
    except Exception:
        return False


def _mac_clear_login_message() -> None:
    try:
        subprocess.run(["defaults", "delete",
                        "/Library/Preferences/com.apple.loginwindow",
                        "LoginwindowText"],
                       capture_output=True, text=True, timeout=10)
    except Exception:
        pass


def _mac_user_has_session(user: str) -> bool:
    """True while `user` still owns the live GUI session (i.e. they are at their
    desktop, not the login window)."""
    return _mac_console_user() == user


def _mac_force_logout(user: str) -> None:
    """Kick `user` to the login window. `launchctl bootout` ends their GUI session;
    if that does not stick we escalate to killing their processes."""
    uid = _mac_uid_for(user)
    if uid is not None:
        subprocess.run(["launchctl", "bootout", f"user/{uid}"],
                       capture_output=True, text=True, timeout=20)
        time.sleep(1)
    if _mac_user_has_session(user):
        subprocess.run(["pkill", "-KILL", "-u", user],
                       capture_output=True, text=True, timeout=15)
        time.sleep(1)


def _linux_console_user() -> str | None:
    """Best-effort: the human user logged into the graphical/console session —
    the one a hard lock must lock out. Only meaningful when running as root."""
    try:
        out = subprocess.run(["loginctl", "list-sessions", "--no-legend"],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 3:
                uid, user = parts[1], parts[2]
                try:
                    if int(uid) >= 1000 and user != "root":
                        return user
                except ValueError:
                    continue
    except Exception:
        pass
    try:
        out = subprocess.run(["who"], capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            cols = line.split()
            if cols and cols[0] != "root":
                return cols[0]
    except Exception:
        pass
    su = os.environ.get("SUDO_USER")
    return su if su and su != "root" else None


def _linux_user_has_session(user: str) -> bool:
    """True if `user` still has an active login session (root-only check)."""
    try:
        out = subprocess.run(["loginctl", "list-sessions", "--no-legend"],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[2] == user:
                return True
    except Exception:
        # If we cannot determine it, assume a session may remain (fail safe:
        # the caller treats "unknown" as "still there" and reports honestly).
        return True
    return False


def _linux_account_locked(user: str) -> bool | None:
    """Whether the account password is locked, via `passwd -S` (root-only).
    Returns True (locked), False (usable), or None if it cannot be determined."""
    try:
        r = subprocess.run(["passwd", "-S", user], capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return None
        parts = r.stdout.split()
        if len(parts) >= 2:
            # field 2: L/LK = locked, P/PS = usable password, NP = no password
            return parts[1] in ("L", "LK")
    except Exception:
        return None
    return None


def _linux_unlock_account(user: str) -> tuple[bool, str]:
    """Unlock the account using both available methods, then verify. Returns
    (ok, detail). ok is True only if the account is confirmed not locked."""
    subprocess.run(["usermod", "--unlock", user], capture_output=True, text=True, timeout=15)
    if _linux_account_locked(user) is False:
        return (True, "usermod --unlock")
    subprocess.run(["passwd", "-u", user], capture_output=True, text=True, timeout=15)
    locked = _linux_account_locked(user)
    if locked is False:
        return (True, "passwd -u")
    if locked is None:
        # Cannot verify either way; report best-effort outcome honestly.
        return (False, "unlock attempted but could not be verified")
    return (False, "account is still locked after both unlock methods")


def _win_lock_now() -> tuple[bool, str | None]:
    """Issue the Windows workstation lock. Returns (ok, error). Idempotent —
    safe to call when the screen is already locked."""
    try:
        import ctypes
        ret = ctypes.windll.user32.LockWorkStation()
        if ret:
            return (True, None)
        err = ctypes.windll.kernel32.GetLastError()
        return (False, f"LockWorkStation failed (Windows error {err})")
    except Exception as e:
        return (False, f"LockWorkStation unavailable ({e})")


def _apply_hard_lock() -> tuple[str, str | None, str | None]:
    """Lock the device at the OS level. Returns (status, result, error) where
    status is 'completed' (truly locked), 'failed', or 'requires_admin'.
    On Linux the locked username is persisted so unlock can target it later."""
    try:
        if IS_WIN:
            ok, err = _win_lock_now()
            if ok:
                _write_lock_state({"locked": True, "platform": "windows"})
                return ("completed", "Workstation locked", None)
            return ("failed", None, err)

        if IS_MAC:
            # TRUE login-window lock: bar the account from logging in and drop the
            # user to the login window, where a custom banner tells them to contact
            # IT. The user's password is rejected — this is NOT a dismissable screen
            # lock. It needs root, so the agent must run as a system LaunchDaemon.
            if not _is_root():
                return ("requires_admin", None,
                        "Hard lock requires admin. This Mac's agent is running as a "
                        "normal user and cannot lock the login window, so the device "
                        "was NOT locked. Reinstall the agent with admin rights (sudo) "
                        "using the portal install command, then retry.")
            user = _mac_console_user()
            if not user:
                humans = _mac_human_users()
                user = humans[0] if len(humans) == 1 else None
            if not user:
                return ("failed", None,
                        "Could not determine which macOS account to lock (no user at "
                        "the console and the account is ambiguous).")
            # 1) Show the login-window banner (verified by read-back).
            banner_ok = _mac_set_login_message(MAC_LOCK_MESSAGE)
            # 2) Disable the account so the password is rejected at the login window.
            ok, detail = _mac_disable_account(user)
            if not ok:
                _mac_clear_login_message()
                return ("failed", None,
                        f"Failed to lock account '{user}': {detail}. The device was "
                        f"NOT locked.")
            # 3) Kick the user to the login window so the lock takes effect now.
            _mac_force_logout(user)
            if _mac_user_has_session(user):
                # Could not evict the live session: the person can keep using the Mac.
                # Roll the lock back to a consistent UNLOCKED state and report honestly.
                _mac_enable_account(user)
                _mac_clear_login_message()
                return ("failed", None,
                        f"Account '{user}' was disabled but the active session could "
                        f"not be ended, so the user can still use the Mac. The lock was "
                        f"rolled back — please retry.")
            _write_lock_state({"locked": True, "platform": "macos", "user": user})
            # The password rejection (account disable) is the actual lock; the banner
            # is informational. Report success honestly but flag if the banner could
            # not be confirmed so IT knows the message may not be visible.
            banner_note = ("" if banner_ok
                           else "; WARNING: the login-window banner could not be "
                                "confirmed and may not be visible")
            return ("completed",
                    f"Account '{user}' locked at the login window ({detail}){banner_note}",
                    None)

        if IS_LIN:
            if not _is_root():
                return ("requires_admin", None,
                        "Hard lock requires root. This agent is running as a normal "
                        "user (systemd --user) and cannot lock the OS account, so the "
                        "device was NOT locked. Reinstall the agent as a system service "
                        "with sudo (see the portal install command) to enforce hard lock.")
            user = _linux_console_user()
            if not user:
                return ("failed", None, "Could not determine the logged-in user to lock.")
            # 1) Password-lock the account so the user cannot log back in.
            r = subprocess.run(["usermod", "--lock", user], capture_output=True, text=True, timeout=15)
            if r.returncode != 0:
                r = subprocess.run(["passwd", "-l", user], capture_output=True, text=True, timeout=15)
                if r.returncode != 0:
                    return ("failed", None,
                            f"Failed to lock account '{user}': {r.stderr.strip()}")
            # Positively verify the account is actually locked — never trust the exit
            # code alone. If verification explicitly says it is NOT locked, report a
            # failure rather than a false "Locked".
            if _linux_account_locked(user) is False:
                return ("failed", None,
                        f"The lock command returned success but account '{user}' is "
                        f"still reported as unlocked, so the device was NOT locked.")
            # 2) Terminate the active session so the user is kicked out NOW. We must
            #    confirm the session is actually gone — a still-running session means
            #    the user can keep using the device, which is NOT a real lock.
            subprocess.run(["loginctl", "terminate-user", user], capture_output=True, text=True, timeout=15)
            if _linux_user_has_session(user):
                # Escalate: kill all of the user's processes/scopes.
                subprocess.run(["loginctl", "kill-user", user], capture_output=True, text=True, timeout=15)
                time.sleep(1)
            if _linux_user_has_session(user):
                # Could not evict the live session. Roll the account lock back so the
                # device is left in a consistent UNLOCKED state and report the truth —
                # never a false "locked". Verify the rollback actually succeeded.
                ok, detail = _linux_unlock_account(user)
                if not ok:
                    return ("failed", None,
                            f"Account '{user}' could not be fully locked (the active "
                            f"session could not be terminated) AND the rollback failed: "
                            f"{detail}. The account may still be locked — unlock it "
                            f"manually as root, then retry.")
                return ("failed", None,
                        f"Account '{user}' could not be fully locked: the active session "
                        f"could not be terminated, so the user can still use the device. "
                        f"The partial lock was rolled back. Please retry.")
            _write_lock_state({"locked": True, "platform": "linux", "user": user})
            return ("completed", f"Account '{user}' locked and session terminated", None)

        return ("failed", None, f"unsupported platform: {sys.platform}")
    except Exception as e:
        return ("failed", None, str(e))


def _release_lock() -> tuple[str, str | None, str | None]:
    """Undo a hard lock. Returns (status, result, error)."""
    try:
        if IS_LIN:
            if not _is_root():
                # A non-root agent can NEVER produce a confirmed hard lock (it
                # returns requires_admin), so any unlock command reaching it must
                # correspond to a lock applied by a root agent — which a non-root
                # agent cannot undo. Always report requires_admin so the server's
                # is_locked is never falsely cleared (regardless of local state).
                return ("requires_admin", None,
                        "Cannot unlock: undoing an OS account lock requires root, but "
                        "this agent is running as a normal user. Reinstall the agent as "
                        "a system service with sudo, then retry the unlock.")
            user = _read_lock_state().get("user") or _linux_console_user()
            if not user:
                return ("failed", None, "Could not determine which account to unlock.")
            ok, detail = _linux_unlock_account(user)
            if not ok:
                return ("failed", None, f"Failed to unlock account '{user}': {detail}")
            _write_lock_state({"locked": False})
            return ("completed", f"Account '{user}' unlocked ({detail})", None)
        if IS_MAC:
            if not _is_root():
                # A non-root agent can never apply a confirmed macOS lock (it returns
                # requires_admin), so any unlock reaching it corresponds to a lock a
                # root agent applied — which this agent cannot undo. Report honestly so
                # the server's is_locked is never falsely cleared.
                return ("requires_admin", None,
                        "Cannot unlock: undoing a macOS login-window lock requires "
                        "admin, but this agent is running as a normal user. Reinstall "
                        "the agent with admin rights (sudo), then retry the unlock.")
            user = _read_lock_state().get("user") or _mac_console_user()
            if not user:
                humans = _mac_human_users()
                user = humans[0] if len(humans) == 1 else None
            if not user:
                return ("failed", None, "Could not determine which account to unlock.")
            ok, detail = _mac_enable_account(user)
            _mac_clear_login_message()
            if not ok:
                return ("failed", None, f"Failed to unlock account '{user}': {detail}")
            _write_lock_state({"locked": False})
            return ("completed", f"Account '{user}' unlocked ({detail})", None)
        # Windows workstation lock leaves nothing persistent to undo.
        _write_lock_state({"locked": False})
        return ("completed", "Access restored", None)
    except Exception as e:
        return ("failed", None, str(e))


def reconcile_lock(server_locked: bool) -> None:
    """Keep the OS in sync with the server's confirmed lock flag (best-effort,
    no command reporting). Only acts on a transition to avoid re-locking each
    heartbeat. Used by the sync loop and on startup."""
    with _lock_mutex:
        local = _read_local_lock()
        if server_locked and not local:
            _apply_hard_lock()
        elif not server_locked and local:
            _release_lock()


def reassert_lock() -> None:
    """While the device is meant to be locked, keep the OS lock asserted. The
    Windows workstation lock is dismissed the moment the user types their password,
    so without re-asserting a 'locked' device becomes usable again while the portal
    still shows Locked. Re-issuing the screen lock each fast cycle keeps the user
    out. macOS and Linux use a persistent ACCOUNT lock (login-window lock / password
    lock), so they need no re-assertion here. Best-effort and silent: never reports a
    command status, never flips local state."""
    if not IS_WIN:
        return
    try:
        if not _read_local_lock():
            return
        with _lock_mutex:
            if not _read_local_lock():
                return
            _win_lock_now()
    except Exception:
        pass


# ── restart management ──────────────────────────────────────────────────────
RESTART_GRACE_SEC = 600  # 10-minute warning before any restart actually happens.


def _notify_user(title: str, message: str) -> bool:
    """Best-effort, non-blocking desktop notification to the logged-in human.
    Never raises. Returns True if a notification mechanism was invoked."""
    try:
        if IS_WIN:
            CREATE_NO_WINDOW = 0x08000000
            # msg.exe is the most reliable interactive popup and needs no admin on
            # most editions; fall back to a WinForms message box via PowerShell.
            try:
                subprocess.Popen(["msg", "*", "/TIME:0", f"{title}: {message}"],
                                 creationflags=CREATE_NO_WINDOW)
                return True
            except Exception:
                ps = ("Add-Type -AssemblyName System.Windows.Forms; "
                      "[System.Windows.Forms.MessageBox]::Show("
                      f"{json.dumps(message)},{json.dumps(title)})")
                subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden",
                                  "-Command", ps], creationflags=CREATE_NO_WINDOW)
                return True
        if IS_MAC:
            user = _mac_console_user() if _is_root() else None
            script = (f'display notification {json.dumps(message)} '
                      f'with title {json.dumps(title)}')
            args = ["osascript", "-e", script]
            if user:
                # Run inside the console user's GUI session when we are root.
                args = ["launchctl", "asuser", str(_mac_uid_for(user) or ""), *args]
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        if IS_LIN:
            subprocess.Popen(["notify-send", title, message],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
    except Exception:
        pass
    return False


def _schedule_restart(delay_sec: int, force: bool, reason: str) -> tuple[str, str | None, str | None]:
    """Schedule an OS restart after a grace period, warning the user first.
    Always warns and always waits — there is no immediate, unannounced restart.
    The grace period is floored at RESTART_GRACE_SEC (10 min) so a restart can
    never be scheduled sooner, regardless of the requested delay."""
    delay_sec = max(RESTART_GRACE_SEC, int(delay_sec or RESTART_GRACE_SEC))
    mins = max(1, delay_sec // 60)
    warn = (f"{reason} Your computer will restart in about {mins} minute"
            f"{'s' if mins != 1 else ''}. Please save your work.")
    _notify_user("Scheduled restart", warn)
    try:
        if IS_WIN:
            CREATE_NO_WINDOW = 0x08000000
            args = ["shutdown", "/r", "/t", str(delay_sec), "/c", warn[:512]]
            if force:
                args.insert(3, "/f")
            r = subprocess.run(args, capture_output=True, text=True,
                               timeout=20, creationflags=CREATE_NO_WINDOW)
            if r.returncode != 0:
                return ("failed", None,
                        f"Could not schedule restart: {r.stderr.strip() or r.stdout.strip()}")
            return ("completed",
                    f"Restart scheduled in {mins} min (user warned).", None)
        if IS_MAC or IS_LIN:
            if not _is_root():
                return ("requires_admin", None,
                        "Scheduling a restart requires admin rights, but the agent is "
                        "running as a normal user. Reinstall the agent as a system "
                        "service (sudo) to enable restart actions.")
            # `shutdown -r +<minutes>` warns logged-in users automatically.
            r = subprocess.run(["shutdown", "-r", f"+{mins}", warn[:200]],
                               capture_output=True, text=True, timeout=20)
            if r.returncode != 0:
                return ("failed", None,
                        f"Could not schedule restart: {r.stderr.strip() or r.stdout.strip()}")
            return ("completed",
                    f"Restart scheduled in {mins} min (user warned).", None)
    except Exception as e:
        return ("failed", None, str(e))
    return ("failed", None, f"unsupported platform: {sys.platform}")


# ── commands ────────────────────────────────────────────────────────────────
def execute_command(cmd: dict) -> tuple[str, str | None, str | None]:
    """Returns (status, result_message, error_message). status is one of
    'completed', 'failed', or 'requires_admin' — only 'completed' means the
    action truly took effect."""
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
    if ctype == "lock_screen":
        with _lock_mutex:
            return _apply_hard_lock()
    if ctype == "unlock":
        with _lock_mutex:
            return _release_lock()
    if ctype == "notify_restart":
        payload = cmd.get("payload") or {}
        days = payload.get("uptime_days")
        if days:
            reason = (f"This computer has been running for {days} day"
                      f"{'s' if str(days) != '1' else ''} without a restart.")
        else:
            reason = "IT is asking you to restart this computer."
        msg = f"{reason} Please save your work and restart soon to keep it healthy and secure."
        if _notify_user("Please restart your computer", msg):
            return ("completed", "User notified to restart.", None)
        return ("failed", None, "Could not show a notification to the user.")
    if ctype in ("schedule_restart", "force_restart"):
        payload = cmd.get("payload") or {}
        delay = payload.get("delay_seconds", RESTART_GRACE_SEC)
        reason = payload.get("reason") or "IT has scheduled a restart for this computer."
        return _schedule_restart(delay, force=(ctype == "force_restart"), reason=reason)
    if ctype == "uninstall_agent":
        return _self_uninstall()
    return ("failed", None, f"unsupported command: {ctype}")


# ── self-uninstall (remove the agent from this laptop) ───────────────────────
# Removing the agent only ends the management connection: it stops the
# background service, deletes the local agent files, and removes the saved
# token. It never touches the user's own files or data.
_uninstall_requested = False


def _remaining_service_artifacts() -> list[str]:
    """Return service/autostart paths that should be gone after uninstall but
    still exist. We verify rather than trust the helpers' best-effort return
    codes. On Windows the install dir holds the *running* script and can only be
    deleted after the process exits (see _final_self_destruct), so we check the
    Startup launcher (.vbs) — once it's gone the agent will not auto-start again;
    the directory itself is cleaned up by the deferred job."""
    if IS_MAC:
        candidates = [MAC_DAEMON_PLIST_PATH, MAC_SYS_INSTALL_DIR,
                      MAC_PLIST_PATH, MAC_INSTALL_DIR]
    elif IS_LIN:
        candidates = [LIN_SYS_UNIT_PATH, LIN_SYS_INSTALL_DIR,
                      LIN_UNIT_PATH, LIN_INSTALL_DIR]
    elif IS_WIN:
        candidates = [WIN_VBS_PATH]
    else:
        candidates = []
    return [p for p in candidates if p and os.path.exists(p)]


def _self_uninstall() -> tuple[str, str | None, str | None]:
    """Tear down this agent locally. The actual process exit happens in the run
    loop *after* this status is reported back to the portal, so the portal can
    confirm the removal (it revokes the token + marks the device removed only on
    the confirmed 'completed')."""
    global _uninstall_requested
    warnings: list[str] = []   # non-fatal: removal still succeeded
    failures: list[str] = []   # fatal: agent would keep running / stay managed

    # 1. Never leave the user locked out by a half-removed agent. A failure here
    #    does NOT block removal (it is a safety nicety), but is surfaced.
    try:
        with _lock_mutex:
            _release_lock()
    except Exception as e:
        warnings.append(f"lock release: {e}")

    # 2. Stop + remove the background service / autostart and installed files.
    #    (Windows: removes the Startup launcher + %LOCALAPPDATA%\MilesAgent incl.
    #     the token-bearing run.cmd. macOS: unloads launchd + removes the daemon
    #     dir incl. the 0600 token file. Linux: disables + removes the unit.)
    #    If this fails the service keeps running, so it is a FATAL failure: we
    #    must NOT tell the portal the agent is gone. The platform helpers are
    #    best-effort and swallow errors, so we VERIFY the artifacts are actually
    #    gone afterwards rather than trusting the return code.
    try:
        rc = uninstall_service()
        if rc not in (0, None):
            failures.append(f"service removal returned {rc}")
    except Exception as e:
        failures.append(f"service removal: {e}")
    for leftover in _remaining_service_artifacts():
        failures.append(f"service/autostart still present: {leftover}")

    # 3. Remove the local state dir (venv/script copy, lock + wallpaper state,
    #    install log) and the macOS root token file. A leftover token means the
    #    agent could re-authenticate, so a failure here is also FATAL. Verify the
    #    paths are actually gone rather than trusting rmtree(ignore_errors=True).
    for path in (os.path.join(os.path.expanduser("~"), ".miles-agent"),
                 MAC_SYS_TOKEN_FILE if IS_MAC else None):
        if not path:
            continue
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            elif os.path.exists(path):
                os.remove(path)
            if os.path.exists(path):
                failures.append(f"cleanup {path}: still present after removal")
        except Exception as e:
            failures.append(f"cleanup {path}: {e}")

    # Honest confirmation: only report 'completed' when the agent is genuinely
    # gone. On any fatal failure report 'failed' and DO NOT exit — the device
    # stays managed so an admin can retry or Force Remove from the portal.
    if failures:
        return ("failed",
                None,
                "Uninstall did not complete; device is still managed. "
                + "; ".join(failures + warnings))

    _uninstall_requested = True
    if warnings:
        return ("completed",
                "Agent management removed (with minor cleanup warnings).",
                "; ".join(warnings))
    return ("completed",
            "Agent uninstalled: background service stopped, local files and saved token removed.",
            None)


def _final_self_destruct() -> None:
    """Called once, after the uninstall status has been reported, to remove any
    files that were still locked while the agent was running. On Windows the
    running script/exe in %LOCALAPPDATA%\\MilesAgent can't delete itself, so a
    detached cmd waits a moment and removes the directory after we exit."""
    try:
        if IS_WIN and WIN_INSTALL_DIR and os.path.isdir(WIN_INSTALL_DIR):
            CREATE_NO_WINDOW = 0x08000000
            DETACHED_PROCESS = 0x00000008
            subprocess.Popen(
                ["cmd", "/c", "ping 127.0.0.1 -n 3 >nul & rmdir /s /q "
                 + f'"{WIN_INSTALL_DIR}"'],
                creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
                close_fds=True,
            )
    except Exception:
        pass


_last_uptime_notice = 0.0


def _maybe_notify_long_uptime() -> None:
    """If the machine has been up for more than a day, gently remind the user to
    restart. Throttled to at most once every 12 hours so it never nags."""
    global _last_uptime_notice
    try:
        up = _uptime_seconds()
        if up is None or up < 86400:
            return
        now = time.monotonic()
        if _last_uptime_notice and (now - _last_uptime_notice) < 12 * 3600:
            return
        days = up // 86400
        _notify_user(
            "Please restart your computer",
            f"This computer has been running for {days} day"
            f"{'s' if days != 1 else ''} without a restart. Please save your work "
            f"and restart soon to keep it healthy and secure.",
        )
        _last_uptime_notice = now
    except Exception:
        pass


def _looks_revoked(resp: dict) -> bool:
    """True only when the server EXPLICITLY rejected our token (the portal
    Force-Removed this device), never for a transient network/5xx error.
    agent_sync / agent_fetch_commands return success:false with this exact
    message once the token row is revoked."""
    if not isinstance(resp, dict) or resp.get("success"):
        return False
    err = str(resp.get("error", "")).lower()
    return "revoked token" in err or "invalid or revoked" in err


def poll_commands() -> bool:
    """Poll + execute queued commands. Returns True if the portal has revoked our
    token (so the caller can tear the agent down and exit)."""
    resp = _get("/commands")
    if not resp.get("success"):
        return _looks_revoked(resp)
    for cmd in resp.get("commands", []):
        status, result, err = execute_command(cmd)
        _post("/commands/status", {
            "id":     cmd["id"],
            "status": status,
            "result": result,
            "error":  err,
        })
        # A confirmed uninstall is terminal: the local files/token are gone, so
        # never run any further command claimed in the same batch. The run loop
        # sees _uninstall_requested next and exits.
        if _uninstall_requested:
            break
    return False


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


_SINGLETON_HANDLE = None  # kept alive for the process lifetime so the lock holds


def _acquire_singleton() -> bool:
    """Ensure only one `run` loop is active per user. Re-running install-service,
    a second logon launch, or a manual `run` must not spawn a duplicate agent
    (which would double every sync and command). Returns True if we own the lock."""
    global _SINGLETON_HANDLE
    if IS_WIN:
        try:
            import ctypes
            ERROR_ALREADY_EXISTS = 183
            # Per-user named mutex (Local\ namespace = current session/user).
            h = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\MilesAgentSingleton")
            if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
                return False
            _SINGLETON_HANDLE = h
            return True
        except Exception:
            return True  # never block the agent if the guard itself fails
    try:
        import fcntl
        lock_path = os.path.join(tempfile.gettempdir(), f"miles-agent-{os.getuid()}.lock")
        fh = open(lock_path, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _SINGLETON_HANDLE = fh  # held until process exit
        return True
    except OSError:
        return False
    except Exception:
        return True


def run_loop() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN is not set", file=sys.stderr); return 2
    if not _acquire_singleton():
        print("Another Miles agent is already running for this user — exiting.", file=sys.stderr)
        return 0
    # Re-assert the last-known lock immediately so a reboot — even offline —
    # keeps the device locked before the first /sync round-trips. On Linux the
    # account stays password-locked across reboot anyway; this also kicks any
    # session that came up.
    try:
        if _read_local_lock():
            with _lock_mutex:
                _apply_hard_lock()
    except Exception:
        pass
    last_sync = 0.0
    revoked_strikes = 0
    while True:
        now = time.monotonic()
        try:
            # Heavy system sync + wallpaper + lock reconcile on the slow cycle.
            if now - last_sync >= SYNC_INTERVAL_SEC:
                sync = _post("/sync", {"payload": collect_system_info()})
                if isinstance(sync, dict) and sync.get("success") and ("locked" in sync):
                    reconcile_lock(bool(sync.get("locked")))
                apply_active_wallpaper()   # post-sync wallpaper check (no-op if unchanged)
                _maybe_notify_long_uptime()
                last_sync = now
            # Commands (lock / unlock) on the fast cycle so they apply in seconds.
            # poll_commands() also reports if the portal has revoked our token
            # (Force Remove from Portal). Two consecutive revoked polls — never a
            # one-off network blip — means we must stop managing this laptop:
            # tear ourselves down and exit so no background process or console
            # window is left running.
            if poll_commands():
                revoked_strikes += 1
                if revoked_strikes >= 2:
                    # Token revoked server-side: the device is already removed, so
                    # staying alive serves no purpose — we always stop. Still run
                    # the local teardown and report its result honestly rather
                    # than silently assuming the cleanup succeeded.
                    try:
                        status, _msg, warn = _self_uninstall()
                        if status != "completed":
                            print(f"Token revoked; local cleanup incomplete: {warn}",
                                  file=sys.stderr)
                    except Exception as e:
                        print(f"Token revoked; local cleanup error: {e}", file=sys.stderr)
                    print("Agent token revoked by portal — exiting.", file=sys.stderr)
                    _final_self_destruct()
                    return 0
            else:
                revoked_strikes = 0
            # An uninstall command tore the agent down (and poll_commands has
            # just reported its result to the portal). Exit cleanly now; on
            # Windows hand off a detached job to delete the still-locked files.
            if _uninstall_requested:
                print("Agent uninstalled — exiting.", file=sys.stderr)
                _final_self_destruct()
                return 0
            # Keep a locked device locked: re-assert the Windows/macOS screen
            # lock every fast cycle (no-op on Linux / when unlocked). Runs after
            # poll_commands so an incoming unlock clears local state first and we
            # don't re-lock in the same cycle.
            reassert_lock()
        except Exception as e:
            print(f"[{datetime.now(timezone.utc).isoformat()}] loop error: {e}", file=sys.stderr)
        time.sleep(COMMAND_POLL_SEC)


# ── service install (auto-start after reboot) ───────────────────────────────
MAC_PLIST_LABEL = "com.miles.agent"
MAC_PLIST_PATH  = os.path.expanduser(f"~/Library/LaunchAgents/{MAC_PLIST_LABEL}.plist")
MAC_INSTALL_DIR = os.path.expanduser("~/Library/Application Support/MilesAgent")
MAC_LOG_OUT     = os.path.expanduser("~/Library/Logs/miles-agent.out.log")
MAC_LOG_ERR     = os.path.expanduser("~/Library/Logs/miles-agent.err.log")

# Root install (required for the TRUE login-window hard lock): a system-wide
# LaunchDaemon that runs as root and survives reboot/logout.
MAC_DAEMON_PLIST_PATH = f"/Library/LaunchDaemons/{MAC_PLIST_LABEL}.plist"
MAC_SYS_INSTALL_DIR   = "/Library/Application Support/MilesAgent"
MAC_SYS_LOG_OUT       = "/Library/Logs/miles-agent.out.log"
MAC_SYS_LOG_ERR       = "/Library/Logs/miles-agent.err.log"


def _xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def install_service_mac() -> int:
    """Install the launchd service that runs `miles-agent run` and survives reboot.
    ROOT  -> a system LaunchDaemon (required for the login-window hard lock).
    non-root -> a per-user LaunchAgent (convenient, but lock reports requires_admin)."""
    if _is_root():
        return _install_service_mac_system()
    return _install_service_mac_impl()


def _remove_legacy_mac_user_agent() -> None:
    """Tear down a previously-installed per-user LaunchAgent so it does not poll
    alongside the new root daemon (which would double-execute and let a non-root
    agent claim lock commands). Runs as the SUDO_USER who launched the install."""
    su = os.environ.get("SUDO_USER")
    if not su or su == "root":
        return
    uid = _mac_uid_for(su)
    legacy_plist = f"/Users/{su}/Library/LaunchAgents/{MAC_PLIST_LABEL}.plist"
    if uid is not None:
        subprocess.run(["launchctl", "bootout", f"gui/{uid}/{MAC_PLIST_LABEL}"],
                       capture_output=True, text=True)
        subprocess.run(["sudo", "-u", su, "launchctl", "unload", legacy_plist],
                       capture_output=True, text=True)
    try:
        if os.path.exists(legacy_plist):
            os.remove(legacy_plist)
    except Exception:
        pass


def _install_service_mac_system() -> int:
    """Root install: a system-wide LaunchDaemon that runs as root so it can enforce
    the macOS login-window hard lock (disable account + login banner)."""
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    _remove_legacy_mac_user_agent()
    os.makedirs(MAC_SYS_INSTALL_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MAC_SYS_LOG_OUT), exist_ok=True)

    # Store the auth token in a ROOT-ONLY file rather than the world-readable
    # plist, so a local standard user cannot steal it and forge command status.
    try:
        fd = os.open(MAC_SYS_TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as tf:
            tf.write(TOKEN)
        os.chown(MAC_SYS_TOKEN_FILE, 0, 0)
        os.chmod(MAC_SYS_TOKEN_FILE, 0o600)
    except OSError as e:
        print(f"ERROR: could not write secure token file {MAC_SYS_TOKEN_FILE}: {e}",
              file=sys.stderr)
        return 1

    prog_args, dst = _service_program_args(MAC_SYS_INSTALL_DIR)
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
    <key>MILES_AGENT_API_BASE</key><string>{_xml_escape(API_BASE)}</string>
    <key>MILES_AGENT_SYNC_INTERVAL</key><string>{SYNC_INTERVAL_SEC}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{_xml_escape(MAC_SYS_LOG_OUT)}</string>
  <key>StandardErrorPath</key><string>{_xml_escape(MAC_SYS_LOG_ERR)}</string>
</dict>
</plist>
"""
    with open(MAC_DAEMON_PLIST_PATH, "w") as fh:
        fh.write(plist)
    # LaunchDaemons must be owned root:wheel and not group/world writable or launchd
    # refuses to load them.
    try:
        os.chown(MAC_DAEMON_PLIST_PATH, 0, 0)
    except Exception:
        pass
    os.chmod(MAC_DAEMON_PLIST_PATH, 0o644)

    subprocess.run(["launchctl", "unload", MAC_DAEMON_PLIST_PATH],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    r = subprocess.run(["launchctl", "load", "-w", MAC_DAEMON_PLIST_PATH],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        print("ERROR: launchctl load failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
        return 1

    print(f"✓ System service '{MAC_PLIST_LABEL}' installed and started (root).")
    print(f"  Binary:   {dst}")
    print(f"  Plist:    {MAC_DAEMON_PLIST_PATH}")
    print(f"  Logs:     {MAC_SYS_LOG_OUT}")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds (auto-starts at boot)")
    print("  Hard lock: ENABLED (login-window lock with custom message)")
    return 0


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
    # System LaunchDaemon (root install).
    if os.path.exists(MAC_DAEMON_PLIST_PATH):
        subprocess.run(["launchctl", "unload", MAC_DAEMON_PLIST_PATH],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            os.remove(MAC_DAEMON_PLIST_PATH)
        except Exception:
            pass
        if os.path.isdir(MAC_SYS_INSTALL_DIR):
            shutil.rmtree(MAC_SYS_INSTALL_DIR, ignore_errors=True)
    # Per-user LaunchAgent (legacy / non-root install).
    if os.path.exists(MAC_PLIST_PATH):
        subprocess.run(["launchctl", "unload", MAC_PLIST_PATH],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(MAC_PLIST_PATH)
    if os.path.isdir(MAC_INSTALL_DIR):
        shutil.rmtree(MAC_INSTALL_DIR, ignore_errors=True)
    print("✓ Service uninstalled.")
    return 0


# ── Linux systemd service ───────────────────────────────────────────────────
# Two install modes:
#   * ROOT  -> a SYSTEM service (/etc/systemd/system). Required for the hard
#     lock: only root can usermod -L / terminate another user's session.
#   * non-root -> a per-user service (systemd --user). Convenient, but the agent
#     cannot enforce a hard lock and will report "requires_admin" on lock.
LIN_UNIT_NAME        = "miles-agent.service"
LIN_UNIT_PATH        = os.path.expanduser(f"~/.config/systemd/user/{LIN_UNIT_NAME}")
LIN_INSTALL_DIR      = os.path.expanduser("~/.local/share/miles-agent")
LIN_SYS_UNIT_PATH    = f"/etc/systemd/system/{LIN_UNIT_NAME}"
LIN_SYS_INSTALL_DIR  = "/opt/miles-agent"


def _remove_legacy_user_service() -> None:
    """Best-effort: tear down a previously-installed per-user service so it does
    not poll for commands alongside the new root system service (which would
    cause duplicate execution / a non-root agent claiming lock commands)."""
    su = os.environ.get("SUDO_USER")
    if not su or su == "root":
        return
    try:
        import pwd
        uid = pwd.getpwnam(su).pw_uid
    except Exception:
        return
    env = dict(os.environ, XDG_RUNTIME_DIR=f"/run/user/{uid}")
    subprocess.run(["sudo", "-u", su, "systemctl", "--user", "disable", "--now", LIN_UNIT_NAME],
                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    legacy_unit = f"/home/{su}/.config/systemd/user/{LIN_UNIT_NAME}"
    try:
        if os.path.exists(legacy_unit):
            os.remove(legacy_unit)
    except Exception:
        pass


def _install_service_linux_system() -> int:
    """Root install: a system-wide systemd service that can enforce the hard lock."""
    _remove_legacy_user_service()
    os.makedirs(LIN_SYS_INSTALL_DIR, exist_ok=True)

    prog_args, dst = _service_program_args(LIN_SYS_INSTALL_DIR)
    exec_start = " ".join(shlex.quote(a) for a in prog_args)

    unit = f"""[Unit]
Description=Miles IT Assets Device Agent (system)
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
WantedBy=multi-user.target
"""
    with open(LIN_SYS_UNIT_PATH, "w") as fh:
        fh.write(unit)
    os.chmod(LIN_SYS_UNIT_PATH, 0o600)  # contains token

    for args in (
        ["systemctl", "daemon-reload"],
        ["systemctl", "enable", LIN_UNIT_NAME],
        ["systemctl", "restart", LIN_UNIT_NAME],
    ):
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            print(f"ERROR: {' '.join(args)} failed:", r.stderr.decode(errors="ignore"), file=sys.stderr)
            return 1

    print(f"✓ Service '{LIN_UNIT_NAME}' installed and started (system service, root).")
    print(f"  Binary:   {dst}")
    print(f"  Unit:     {LIN_SYS_UNIT_PATH}")
    print(f"  Status:   systemctl status {LIN_UNIT_NAME}")
    print(f"  Logs:     journalctl -u {LIN_UNIT_NAME} -f")
    print(f"  Sync every: {SYNC_INTERVAL_SEC} seconds")
    print("  Hard lock: ENABLED (running as root).")
    return 0


def install_service_linux() -> int:
    """Install a systemd service that runs the agent and survives reboot.
    Runs as a SYSTEM service when invoked as root (enables hard lock); otherwise
    falls back to a per-user service (hard lock unavailable)."""
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    if _is_root():
        return _install_service_linux_system()

    print("WARNING: installing as a per-user service (not root). Remote HARD LOCK will")
    print("         NOT work — the agent cannot lock the OS account without root. To")
    print("         enable hard lock, reinstall with: sudo python3 laptop_agent.py install")
    print()

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
    print("  Hard lock: DISABLED (per-user service, no root).")
    print()
    print("To keep the agent running when you are logged out (headless servers), run once:")
    print(f"  sudo loginctl enable-linger {os.environ.get('USER', '$USER')}")
    return 0


def uninstall_service_linux() -> int:
    if _is_root():
        subprocess.run(["systemctl", "disable", "--now", LIN_UNIT_NAME],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(LIN_SYS_UNIT_PATH):
            os.remove(LIN_SYS_UNIT_PATH)
        subprocess.run(["systemctl", "daemon-reload"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.isdir(LIN_SYS_INSTALL_DIR):
            shutil.rmtree(LIN_SYS_INSTALL_DIR, ignore_errors=True)
        print("✓ System service uninstalled.")
        return 0

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


# ── Windows logon auto-start (Startup folder — no admin required) ────────────
# A per-user scheduled task (schtasks /SC ONLOGON) requires elevation and fails
# with "Access is denied" from a normal Command Prompt. The Startup folder runs
# at every logon for the current user with no admin rights, so we drop a hidden
# VBScript launcher there that starts the agent via pythonw (no console window).
WIN_INSTALL_DIR = os.path.expandvars(r"%LOCALAPPDATA%\MilesAgent") if IS_WIN else ""
WIN_STARTUP_DIR = (os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
                   if IS_WIN else "")
WIN_VBS_PATH    = os.path.join(WIN_STARTUP_DIR, "MilesAgent.vbs") if IS_WIN else ""
WIN_RUN_CMD     = os.path.join(WIN_INSTALL_DIR, "run.cmd") if IS_WIN else ""


def install_service_windows() -> int:
    if not TOKEN:
        print("ERROR: MILES_AGENT_TOKEN must be set so the background service can authenticate.",
              file=sys.stderr)
        return 2

    os.makedirs(WIN_INSTALL_DIR, exist_ok=True)
    os.makedirs(WIN_STARTUP_DIR, exist_ok=True)

    if getattr(sys, "frozen", False):
        # PyInstaller binary — launch it directly.
        exe = os.path.abspath(sys.argv[0])
        dst = os.path.join(WIN_INSTALL_DIR, "miles-agent.exe")
        if os.path.abspath(exe) != os.path.abspath(dst):
            shutil.copy2(exe, dst)
        # Run the binary directly inside the (hidden) launcher cmd — do NOT use
        # `start`, which spawns a SEPARATE window that stays visible.
        run_line = f'"{dst}" run'
        shown = dst
    else:
        # Script mode — copy the .py and launch it with the windowless interpreter
        # (pythonw.exe next to the current python, e.g. the venv) so no console shows.
        src = os.path.abspath(sys.argv[0])
        dst = os.path.join(WIN_INSTALL_DIR, "laptop_agent.py")
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copy2(src, dst)
        py_dir = os.path.dirname(os.path.abspath(sys.executable))
        pythonw = os.path.join(py_dir, "pythonw.exe")
        if not os.path.exists(pythonw):
            pythonw = os.path.abspath(sys.executable)
        # Run the interpreter directly inside the (hidden) launcher cmd. We must
        # NOT use `start ""` here: `start` opens a brand-new console window that
        # stays visible whenever pythonw.exe is missing and we fall back to the
        # console python.exe — that is the persistent black cmd window users saw.
        # Running in-place keeps the agent inside the VBS-launched hidden cmd.
        run_line = f'"{pythonw}" "{dst}" run'
        shown = dst

    # run.cmd embeds the token/config (same posture as the macOS plist / Linux unit)
    # and runs the agent in-place (the VBS launches this cmd hidden, so the agent
    # inherits that hidden console instead of opening its own visible window).
    with open(WIN_RUN_CMD, "w", encoding="utf-8") as fh:
        fh.write("@echo off\r\n")
        fh.write(f'set "MILES_AGENT_TOKEN={TOKEN}"\r\n')
        fh.write(f'set "MILES_AGENT_API_BASE={API_BASE}"\r\n')
        fh.write(f'set "MILES_AGENT_SYNC_INTERVAL={SYNC_INTERVAL_SEC}"\r\n')
        fh.write(run_line + "\r\n")

    # Hidden launcher in the Startup folder (window style 0 = no flash at logon).
    with open(WIN_VBS_PATH, "w", encoding="utf-8") as fh:
        fh.write('CreateObject("WScript.Shell").Run "cmd /c """ & "'
                 + WIN_RUN_CMD + '" & """", 0, False\r\n')

    # Start it right now too (detached, no console window). DETACHED_PROCESS so
    # it survives the installer exiting; CREATE_NO_WINDOW so nothing flashes.
    try:
        CREATE_NO_WINDOW = 0x08000000
        DETACHED_PROCESS = 0x00000008
        subprocess.Popen(["cmd", "/c", WIN_RUN_CMD],
                         creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
                         close_fds=True)
    except Exception as e:
        print(f"warning: installed, but could not start immediately: {e}", file=sys.stderr)

    print("\u2713 Service installed (Startup folder) — auto-starts at logon, no admin needed.")
    print(f"  Agent:   {shown}")
    print(f"  Startup: {WIN_VBS_PATH}")
    return 0


def uninstall_service_windows() -> int:
    try:
        if WIN_VBS_PATH and os.path.exists(WIN_VBS_PATH):
            os.remove(WIN_VBS_PATH)
    except Exception:
        pass
    if WIN_INSTALL_DIR and os.path.isdir(WIN_INSTALL_DIR):
        shutil.rmtree(WIN_INSTALL_DIR, ignore_errors=True)
    print("\u2713 Service uninstalled.")
    return 0


def install_service() -> int:
    if IS_MAC:  return install_service_mac()
    if IS_LIN:  return install_service_linux()
    if IS_WIN:  return install_service_windows()
    print("Unsupported platform for service install.", file=sys.stderr); return 2


def uninstall_service() -> int:
    if IS_MAC: return uninstall_service_mac()
    if IS_LIN: return uninstall_service_linux()
    if IS_WIN: return uninstall_service_windows()
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
    if cmd == "unregister":
        # Full local teardown: stop the background service, delete the agent's
        # local files, and remove the saved token. Use this to clean up a
        # device the portal has already force-removed. Does not touch user data.
        status, msg, warn = _self_uninstall()
        if status != "completed":
            # Honest exit: teardown did not fully succeed, so the device is still
            # managed. Report the reason and a non-zero code for the operator.
            print(f"ERROR: uninstall did not complete: {warn}", file=sys.stderr)
            return 1
        _final_self_destruct()
        print(msg or "Agent unregistered.")
        if warn:
            print(f"Note: {warn}", file=sys.stderr)
        return 0
    print(f"unknown command: {cmd}", file=sys.stderr); return 2


if __name__ == "__main__":
    sys.exit(main())
