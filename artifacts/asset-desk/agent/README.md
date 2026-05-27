# Miles IT Assets — Windows Laptop Agent

Phase 1 lightweight agent. Single-file Python script, packaged as a Windows `.exe`.

## Build the .exe

```powershell
pip install pyinstaller requests
pyinstaller --onefile --noconsole --name miles-agent laptop_agent.py
# dist\miles-agent.exe
```

## Install on a laptop (admin one-time)

1. In the portal, open the laptop asset → **Device Agent** → **Generate Agent Key**.
2. Copy the key (shown only once).
3. On the laptop, in an **elevated** PowerShell:
   ```powershell
   setx MILES_AGENT_TOKEN "mil_xxxxxxxxxxxxxxxxxxxx" /M
   # Optional employee binding (links the device to the right profile):
   setx MILES_EMPLOYEE_EMAIL "jane.doe@mileseducation.com" /M
   setx MILES_EMPLOYEE_ECODE "M12345" /M
   ```
4. Run once to register:
   ```powershell
   miles-agent.exe register
   ```
5. Schedule the background sync (every 5 minutes):
   ```powershell
   schtasks /Create /TN "MilesAgent" /SC MINUTE /MO 5 ^
     /TR "C:\Path\To\miles-agent.exe run" /RL HIGHEST /F
   ```

## Manual commands

```powershell
miles-agent.exe info       # print collected system info
miles-agent.exe sync       # push one sync
miles-agent.exe register   # bind to portal (first time)
miles-agent.exe run        # long-running loop (used by Task Scheduler)
```

## What it sends

`serial_number, hostname, brand, model, processor, ram, storage, os_name,
os_version, logged_in_username, employee_email, employee_ecode, ip_address,
mac_address, agent_version`.

## Security

- Only the token authenticates the agent. Revoking the token from the portal
  stops sync immediately.
- All requests are HTTPS to the portal's Supabase Edge Function.
- The agent never receives or stores admin credentials.
- Phase 1 supports only **safe** commands: `sync_now`, `collect_system_info`,
  `update_wallpaper`. No wipe / reset.

## Future upgrade path

- Promote to a proper Windows Service (NSSM or `pywin32`) so it auto-starts.
- Migrate the API endpoint by changing `MILES_AGENT_API_BASE` — no code change.
