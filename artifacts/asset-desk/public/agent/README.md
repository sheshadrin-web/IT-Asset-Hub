# Miles IT Assets — Laptop Agent

Phase 1 cross-platform agent. Single Python file, packaged as a native binary
per OS with PyInstaller.

| Platform | Tested on              | Binary name       |
| -------- | ---------------------- | ----------------- |
| Windows  | 10, 11                 | `miles-agent.exe` |
| macOS    | 12 Monterey and newer  | `miles-agent`     |
| Linux    | Ubuntu 20.04+ (GNOME)  | `miles-agent`     |

## Build the binary

You must build on the **target OS** — PyInstaller does not cross-compile.

```bash
pip install pyinstaller requests
pyinstaller --onefile --noconsole --name miles-agent laptop_agent.py
# Windows → dist\miles-agent.exe
# macOS / Linux → dist/miles-agent
```

## Install on a laptop (one-time, by admin)

### 1. Generate the agent key in the portal

Open the laptop asset → **Device Agent** → **Generate Agent Key** → copy the key.

### 2. Set environment variables and run register

**Windows (PowerShell as Administrator):**
```powershell
setx MILES_AGENT_TOKEN "mil_xxxxxxxxxxxx" /M
setx MILES_EMPLOYEE_EMAIL "user@mileseducation.com" /M   # optional
setx MILES_EMPLOYEE_ECODE "M12345" /M                    # optional
# Reopen PowerShell so env vars are picked up
.\miles-agent.exe register
```

**macOS (Terminal):**
```bash
# Add to ~/.zshrc so it survives reboots
echo 'export MILES_AGENT_TOKEN="mil_xxxxxxxxxxxx"' >> ~/.zshrc
echo 'export MILES_EMPLOYEE_EMAIL="user@mileseducation.com"' >> ~/.zshrc
echo 'export MILES_EMPLOYEE_ECODE="M12345"' >> ~/.zshrc
source ~/.zshrc
./miles-agent register
```

**Linux / Ubuntu (bash):**
```bash
echo 'export MILES_AGENT_TOKEN="mil_xxxxxxxxxxxx"' | sudo tee /etc/profile.d/miles-agent.sh
echo 'export MILES_EMPLOYEE_EMAIL="user@mileseducation.com"' | sudo tee -a /etc/profile.d/miles-agent.sh
echo 'export MILES_EMPLOYEE_ECODE="M12345"' | sudo tee -a /etc/profile.d/miles-agent.sh
source /etc/profile.d/miles-agent.sh
./miles-agent register
```

> On Linux, reading the BIOS serial usually requires running the agent as **root**
> (sudo) once during register. After that, regular user is fine for sync.

### 3. Schedule the background sync (every 5 min)

**Windows** — Task Scheduler:
```powershell
schtasks /Create /TN "MilesAgent" /SC MINUTE /MO 5 ^
  /TR "C:\Path\To\miles-agent.exe run" /RL HIGHEST /F
```

**macOS** — launchd:
Save as `~/Library/LaunchAgents/com.miles.agent.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.miles.agent</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/miles-agent</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```
Then: `launchctl load ~/Library/LaunchAgents/com.miles.agent.plist`

**Linux** — systemd user unit at `~/.config/systemd/user/miles-agent.service`:
```ini
[Unit]
Description=Miles IT Assets Agent
After=network-online.target

[Service]
ExecStart=/usr/local/bin/miles-agent run
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
```
Then:
```bash
systemctl --user daemon-reload
systemctl --user enable --now miles-agent.service
```

## Manual commands

```bash
miles-agent info       # print collected system info (no network)
miles-agent register   # first-time bind to portal
miles-agent sync       # send one sync
miles-agent run        # long-running loop (used by scheduler)
```

## What it sends

`serial_number, hostname, brand, model, processor, ram, storage, os_name,
os_version, logged_in_username, employee_email, employee_ecode, ip_address,
mac_address, agent_version`.

## How each OS collects info

| Field          | Windows                          | macOS                          | Linux                                  |
| -------------- | -------------------------------- | ------------------------------ | -------------------------------------- |
| Serial number  | `wmic bios SerialNumber`         | `ioreg IOPlatformSerialNumber` | `/sys/class/dmi/id/product_serial` *   |
| Brand / Model  | `wmic computersystem`            | `sysctl hw.model` ("Apple")    | `/sys/class/dmi/id/{sys_vendor,product_name}` |
| Processor      | `wmic cpu Name`                  | `sysctl machdep.cpu.brand_string` | `/proc/cpuinfo`                     |
| RAM            | `wmic computersystem TotalPhysicalMemory` | `sysctl hw.memsize`   | `/proc/meminfo MemTotal`              |
| Storage        | `Get-CimInstance Win32_DiskDrive` | `df -k /`                     | `lsblk -bdn`                          |
| OS version     | `Get-CimInstance Win32_OperatingSystem` | `sw_vers`               | `/etc/os-release PRETTY_NAME`         |
| Wallpaper      | `SystemParametersInfoW`          | AppleScript `osascript`        | `gsettings org.gnome.desktop.background` |

\* On Linux, `product_serial` is root-protected; run `register` once with `sudo`.

## Security

- Token is the only secret on the machine. Revoking it from the portal stops sync immediately.
- All traffic over HTTPS to the Supabase Edge Function.
- Agent never receives or stores admin credentials.
- Phase 1 supports only **safe** commands: `sync_now`, `collect_system_info`, `update_wallpaper`. No wipe/reset.

## Notes / Caveats

- **macOS wallpaper** requires the agent to have *System Events* automation permission. macOS will prompt on first attempt — click Allow.
- **Linux wallpaper** currently supports GNOME (Ubuntu default). KDE/XFCE/Mate will report "unsupported desktop env" — easy to extend in Phase 2 if needed.
- **macOS Gatekeeper** will block an unsigned binary on first run. Right-click → Open → Open Anyway, or `xattr -d com.apple.quarantine ./miles-agent`. Long term we should sign the binary with an Apple Developer ID.
- The agent ships as a Python build per OS. We can't share one binary across Windows + Mac + Linux.
