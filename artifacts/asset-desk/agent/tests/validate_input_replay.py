#!/usr/bin/env python3
"""Commit 4 — REPLAY validation.

Proves the agent's REAL input pipeline (`apply_remote_input` + the input backend
from laptop_agent.py) performs genuine OS-level mouse + keyboard actions. We drive
the exact production dispatcher and observe the resulting X events with an
independent python-xlib window (and cross-check the pointer with xdotool).

Runs headless under Xvfb using the xdotool backend; on Windows/macOS the very same
apply_remote_input drives the pynput backend instead.
"""
import os, sys, time, threading, subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from laptop_agent import _make_input_backend, apply_remote_input  # REAL agent code

from Xlib import X, XK, display

W, H = 0, 0
def _geom():
    out = subprocess.run(["xdotool", "getdisplaygeometry"], stdout=subprocess.PIPE).stdout.decode()
    a, b = out.split()
    return int(a), int(b)

NAMED = {
    XK.XK_Return: "Return", XK.XK_Tab: "Tab", XK.XK_Escape: "Escape",
    XK.XK_BackSpace: "BackSpace", XK.XK_Delete: "Delete",
    XK.XK_Up: "Up", XK.XK_Down: "Down", XK.XK_Left: "Left", XK.XK_Right: "Right",
    XK.XK_Control_L: "Control_L", XK.XK_Control_R: "Control_R",
    XK.XK_Shift_L: "Shift_L", XK.XK_Shift_R: "Shift_R",
    XK.XK_Alt_L: "Alt_L", XK.XK_Alt_R: "Alt_R", XK.XK_space: "space",
}


class Observer:
    def __init__(self):
        self.d = display.Display()
        scr = self.d.screen()
        self.root = scr.root
        self.win = self.root.create_window(
            0, 0, W, H, 0, scr.root_depth, X.InputOutput, X.CopyFromParent,
            background_pixel=scr.black_pixel,
            event_mask=(X.KeyPressMask | X.KeyReleaseMask | X.ButtonPressMask |
                        X.ButtonReleaseMask | X.PointerMotionMask | X.ExposureMask))
        self.gc = self.win.create_gc(foreground=scr.white_pixel, background=scr.black_pixel)
        self.win.map()
        self.d.sync()
        self.win.set_input_focus(X.RevertToParent, X.CurrentTime)
        self.d.sync()
        self.buttons = []        # (detail, x, y)
        self.motions = []        # (x, y)
        self.keys = []           # (name_or_char, state)
        self.typed = []          # printable chars in order
        self._stop = False
        self._t = threading.Thread(target=self._pump, daemon=True)
        self._t.start()

    def _name(self, keycode, state):
        shift = bool(state & X.ShiftMask)
        ks = self.d.keycode_to_keysym(keycode, 1 if shift else 0)
        if ks == 0:
            ks = self.d.keycode_to_keysym(keycode, 0)
        if ks in NAMED:
            return NAMED[ks], ks
        s = XK.keysym_to_string(ks)
        return (s if s else f"<{ks}>"), ks

    def _pump(self):
        while not self._stop:
            n = self.d.pending_events()
            if not n:
                time.sleep(0.004); continue
            for _ in range(n):
                ev = self.d.next_event()
                if ev.type == X.ButtonPress:
                    self.buttons.append((ev.detail, ev.event_x, ev.event_y))
                    if ev.detail in (1, 2, 3):
                        self.win.fill_rectangle(self.gc, ev.event_x - 7, ev.event_y - 7, 14, 14)
                        self.d.flush()
                elif ev.type == X.MotionNotify:
                    self.motions.append((ev.event_x, ev.event_y))
                elif ev.type == X.KeyPress:
                    name, ks = self._name(ev.detail, ev.state)
                    self.keys.append((name, ev.state))
                    if ks == XK.XK_space:
                        self.typed.append(" ")
                    elif name not in NAMED and not name.startswith("<") and len(name) == 1 \
                            and not (ev.state & X.ControlMask) and not (ev.state & X.Mod1Mask):
                        self.typed.append(name)

    def crosshair(self, x, y):
        self.win.fill_rectangle(self.gc, x - 1, y - 30, 2, 60)
        self.win.fill_rectangle(self.gc, x - 30, y - 1, 60, 2)
        self.d.flush()

    def stop(self):
        self._stop = True


def mouse_pos():
    out = subprocess.run(["xdotool", "getmouselocation", "--shell"],
                         stdout=subprocess.PIPE).stdout.decode()
    kv = dict(line.split("=") for line in out.strip().splitlines())
    return int(kv["X"]), int(kv["Y"])


PASS, FAIL = [], []
def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if detail else ''}")


def norm(x, y):
    return x / (W - 1), y / (H - 1)


def main():
    global W, H
    W, H = _geom()
    be = _make_input_backend()
    assert be is not None, "no input backend"
    print(f"display={W}x{H} backend={be.name}")
    obs = Observer()
    time.sleep(0.5)

    # 1) MOUSE MOVE — ground-truthed by xdotool getmouselocation
    tx, ty = 980, 240
    apply_remote_input({"kind": "mouse", "action": "move", **dict(zip(("x", "y"), norm(tx, ty)))}, be)
    time.sleep(0.25)
    mx, my = mouse_pos()
    check("mouse move", abs(mx - tx) <= 2 and abs(my - ty) <= 2, f"want({tx},{ty}) got({mx},{my})")

    # 2) LEFT CLICK at a point
    cx, cy = 300, 320
    nx, ny = norm(cx, cy)
    apply_remote_input({"kind": "mouse", "action": "down", "button": "left", "x": nx, "y": ny}, be)
    apply_remote_input({"kind": "mouse", "action": "up", "button": "left", "x": nx, "y": ny}, be)
    time.sleep(0.25)
    left = [b for b in obs.buttons if b[0] == 1]
    check("left click", any(abs(b[1] - cx) <= 3 and abs(b[2] - cy) <= 3 for b in left),
          f"left presses={left}")

    # 3) RIGHT CLICK
    rx, ry = 700, 500
    nx, ny = norm(rx, ry)
    apply_remote_input({"kind": "mouse", "action": "down", "button": "right", "x": nx, "y": ny}, be)
    apply_remote_input({"kind": "mouse", "action": "up", "button": "right", "x": nx, "y": ny}, be)
    time.sleep(0.25)
    right = [b for b in obs.buttons if b[0] == 3]
    check("right click", any(abs(b[1] - rx) <= 3 and abs(b[2] - ry) <= 3 for b in right),
          f"right presses={right}")

    # 4) DOUBLE CLICK — two quick left clicks at same spot
    dx, dy = 1050, 600
    nx, ny = norm(dx, dy)
    obs.buttons.clear()
    for _ in range(2):
        apply_remote_input({"kind": "mouse", "action": "down", "button": "left", "x": nx, "y": ny}, be)
        apply_remote_input({"kind": "mouse", "action": "up", "button": "left", "x": nx, "y": ny}, be)
        time.sleep(0.05)
    time.sleep(0.25)
    dbl = [b for b in obs.buttons if b[0] == 1 and abs(b[1] - dx) <= 3 and abs(b[2] - dy) <= 3]
    check("double click", len(dbl) >= 2, f"left presses at target={len(dbl)}")

    # 5) WHEEL — down x3 (button 5), up x2 (button 4)
    obs.buttons.clear()
    apply_remote_input({"kind": "mouse", "action": "wheel", "dx": 0, "dy": 3}, be)
    apply_remote_input({"kind": "mouse", "action": "wheel", "dx": 0, "dy": -2}, be)
    time.sleep(0.3)
    down = sum(1 for b in obs.buttons if b[0] == 5)
    up = sum(1 for b in obs.buttons if b[0] == 4)
    check("wheel scroll", down == 3 and up == 2, f"down(btn5)={down} up(btn4)={up}")

    # focus observer window for keyboard tests
    obs.win.set_input_focus(X.RevertToParent, X.CurrentTime)
    obs.d.sync()
    time.sleep(0.2)

    # 6) KEYBOARD TYPING
    text = "Hello Miles 123"
    obs.typed.clear()
    apply_remote_input({"kind": "key", "action": "type", "text": text}, be)
    time.sleep(0.5)
    got = "".join(obs.typed)
    check("keyboard typing", got == text, f"want={text!r} got={got!r}")

    # 7) SPECIAL KEYS — Enter, Tab, Escape (down/up)
    obs.keys.clear()
    for k in ("Enter", "Tab", "Escape"):
        apply_remote_input({"kind": "key", "action": "down", "key": k}, be)
        apply_remote_input({"kind": "key", "action": "up", "key": k}, be)
        time.sleep(0.05)
    time.sleep(0.3)
    names = [n for n, _ in obs.keys]
    check("special keys", all(x in names for x in ("Return", "Tab", "Escape")), f"keys={names}")

    # 8) CTRL+C COMBO — Control held while 'c' is pressed
    obs.keys.clear()
    apply_remote_input({"kind": "key", "action": "down", "key": "Control"}, be)
    apply_remote_input({"kind": "key", "action": "down", "key": "c"}, be)
    apply_remote_input({"kind": "key", "action": "up", "key": "c"}, be)
    apply_remote_input({"kind": "key", "action": "up", "key": "Control"}, be)
    time.sleep(0.3)
    c_with_ctrl = any(n == "c" and (st & X.ControlMask) for n, st in obs.keys)
    ctrl_seen = any(n in ("Control_L", "Control_R") for n, _ in obs.keys)
    check("ctrl+c combo", c_with_ctrl and ctrl_seen, f"keys={obs.keys}")

    # 9) SHIFT+A COMBO -> uppercase A via modifier (not type path)
    obs.keys.clear()
    apply_remote_input({"kind": "key", "action": "down", "key": "Shift"}, be)
    apply_remote_input({"kind": "key", "action": "down", "key": "a"}, be)
    apply_remote_input({"kind": "key", "action": "up", "key": "a"}, be)
    apply_remote_input({"kind": "key", "action": "up", "key": "Shift"}, be)
    time.sleep(0.3)
    upper_a = any(n == "A" for n, _ in obs.keys)
    check("shift+a combo", upper_a, f"keys={obs.keys}")

    # visual proof: crosshair at final pointer + click markers already drawn
    obs.crosshair(mx, my)
    time.sleep(0.3)
    obs.stop()
    print(f"\nRESULT: {len(PASS)} passed, {len(FAIL)} failed"
          + (f" -> {FAIL}" if FAIL else ""))
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
