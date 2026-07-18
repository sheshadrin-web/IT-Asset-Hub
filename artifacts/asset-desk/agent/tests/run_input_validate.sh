#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
export DISPLAY=:99
export LD_LIBRARY_PATH="/nix/store/2y2hhlki6macaj9j1409q1j6i33l6igf-libxcb-1.17.0/lib:/nix/store/f8kjcizw0kmpyrn1abm1nfsbc007418g-libXau-1.0.12/lib:/nix/store/ycvsz2k1zqcg48as18fcb171rzfdn5ll-libXdmcp-1.1.5/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

pkill -f "Xvfb :99" 2>/dev/null || true
sleep 1
Xvfb :99 -screen 0 1366x768x24 >/tmp/xvfb_input.log 2>&1 &
XPID=$!
sleep 2

PIP_USER=0 ./venv/bin/python validate_input_replay.py
RC=$?

# visual proof of the replayed mouse clicks / crosshair on the observer window
import -window root /tmp/input_proof_raw.png 2>/dev/null || true
convert /tmp/input_proof_raw.png \
  -fill yellow -pointsize 26 -gravity north \
  -annotate +0+20 "Commit 4 — replayed mouse clicks (white squares) + final pointer (crosshair)" \
  /tmp/input_proof.png 2>/dev/null || true

kill "$XPID" 2>/dev/null || true
exit $RC
