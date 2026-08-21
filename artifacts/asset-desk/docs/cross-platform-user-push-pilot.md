# Cross-Platform User Push Pilot

This procedure is local-release guidance only. Do not run it until the migration,
Edge Functions, and agent release have been separately approved.

## Windows pilot

1. Select one controlled Windows laptop with the Miles Agent installed as
   Administrator or SYSTEM.
2. Confirm `miles-it-support` exists and is a member of `Administrators`.
3. Confirm the employee account for the selected Employee Code does not exist.
4. Confirm the portal shows Windows, an assigned active employee, an online
   managed agent, and an enabled `Push User to Device` action.
5. Confirm the dialog shows the employee, canonical lowercase OS username,
   Windows platform, Standard User, and protected administrator notice.
6. Push once and wait for the command to complete.
7. Verify locally that the account exists, is enabled, is not in
   `Administrators`, and has a description marker of
   `MilesEmployeeCode=<CODE>`.
8. Verify `miles-it-support` remains an Administrator and the agent remains
   online.
9. Reveal the temporary credential once through the portal and verify the
   employee can sign in.

## Ubuntu/Linux pilot

1. Select one controlled Ubuntu/Linux laptop with the Miles Agent running as
   root/system service.
2. Confirm `miles-it-support` exists and remains in the configured privileged
   group (`sudo`, `admin`, or `wheel`).
3. Confirm the employee account does not exist.
4. Confirm the portal shows Ubuntu/Linux, an assigned active employee, an online
   managed agent, and an enabled `Push User to Device` action.
5. Push once and wait for the command to complete.
6. Verify `getent passwd <username>` reports a normal-user UID, `/home/<username>`
   exists and is owned by that UID, and the account is not in `sudo`, `admin`, or
   `wheel`.
7. Verify the GECOS marker contains `MilesEmployeeCode=<CODE>`.
8. Verify `miles-it-support` remains privileged and the agent remains online.
9. Reveal the temporary credential once through the portal and verify the
   employee can sign in.

## Stop conditions

Stop immediately if an account is unexpectedly privileged, an existing unrelated
account is detected, the permanent support account changes, the agent goes
offline, the portal reports a false success, or a credential is exposed outside
the one-time reveal flow.

## Rollback

Do not implement automated account deletion in this phase. If a pilot fails,
revoke the pending credential through the existing credential lifecycle, leave
the device untouched for forensic review, and disable further User Push requests
for that asset until IT manually restores the approved baseline. Revert the
local code checkpoint rather than deleting employee profiles automatically.