// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — probe window for macos-dock@local's live checks.
//
// NOT a `*.test.js` file on purpose: it imports GI, so npm test's glob must never
// collect it. test/live-checks.sh drives it and reads dodge's own log lines as
// the oracle.
//
//   GDK_BACKEND=x11 PROBE_MODE=fullscreen PROBE_PREFIX=t3-ab-$RANDOM node test/probe-window.js
//
// Why each piece exists — all of it was learned the expensive way:
//   GDK_BACKEND=x11        the window must be an X11 window so `xprop` can
//                          independently confirm _NET_WM_STATE_FULLSCREEN from
//                          outside the shell. Wayland gives an external observer
//                          nothing to read.
//   window.move()          only honoured under X11; it is how the probe lands on
//                          the monitor the dock is actually on.
//   app.add_window(w)      without it a NON_UNIQUE Gtk.Application returns from
//                          activate() and the process exits immediately.
//   no argv parsing        gjs 1.88 has no `imports.system.program.args`; env
//                          variables are the only portable option channel here.
//   no GLib.get_pid()      does not exist in this gjs.
//   no clipboard, no files writing into the repo
//                          a clipboard manager is running in this session and
//                          would persist anything put on the clipboard.
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const MODE = GLib.getenv('PROBE_MODE') || 'nofs';
const PREFIX = GLib.getenv('PROBE_PREFIX') || 'macosdock-probe';

// Timeline, in ms from activation. Defaults are the values the two-window A/B
// was developed with: the big window must be maximized (covering the dock),
// fullscreen (optional), and then lose focus to a small window that provably
// does NOT overlap the dock — that transition is the discriminant.
const at = (name, fallback) => parseInt(GLib.getenv(`PROBE_STEP_${name}`) || String(fallback), 10);
const T = {
    maximize: at('MAXIMIZE', 1200),
    fullscreen: at('FULLSCREEN', 2800),
    small: at('SMALL', 5200),
    smallClose: at('SMALL_CLOSE', 8600),
    bigClose: at('BIG_CLOSE', 9400),
    quit: at('QUIT', 9900),
    hardStop: at('HARD_STOP', 20000),
    min1: at('MIN1', 1200),
    res1: at('RES1', 2600),
    min2: at('MIN2', 3800),
    res2: at('RES2', 5200),
};

function wall() {
    const dt = GLib.DateTime.new_now_local();
    const us = dt.get_microsecond();
    return `${dt.format('%H:%M:%S')}.${String(us).padStart(6, '0').slice(0, 3)}`;
}
// Every step is stamped on its own line so the harness can align its own
// millisecond clock with the shell's journal.
const log = (s) => print(`${s}\n`);
const step = (label) => log(`STEP ${wall()} ${label}`);
const fail = (label, e) => log(`STEP ${wall()} ${label}-FAILED ${e.message}`);

function schedule(delayMs, label, fn) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
        try { fn(); step(label); } catch (e) { fail(label, e); }
        return GLib.SOURCE_REMOVE;
    });
}

// GTK4 has no public window-positioning API (gtk_window_move was removed), and
// GDK's monitor objects are not the fork's business here: the harness owns
// placement, via `xdotool windowmove` on the X11 window id. Under rootless
// XWayland a plain `present()` already lands the window on a monitor; the
// control run's `overlap -> hide` is what tells the harness whether that was the
// dock's monitor, so no geometry is hardcoded anywhere.

const app = new Gtk.Application({
    application_id: `org.macosdock.Probe${Math.floor(Math.random() * 1e6)}`,
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    log(`MODE ${MODE} PREFIX ${PREFIX}`);

    const big = new Gtk.Window({ title: `${PREFIX}-big`, width_request: 620, height_request: 400 });
    app.add_window(big);
    big.set_child(new Gtk.Label({
        label: `macos-dock probe (${MODE})`,
        margin_top: 40, margin_bottom: 40, margin_start: 40, margin_end: 40,
    }));
    big.present();
    step('big-presented');

    let small = null;

    if (MODE === 'minimize') {
        // State-machine coverage only: _NET_WM_STATE_HIDDEN flips 10-40 ms after
        // the request while the 560 ms actor animation is still running, so this
        // can prove transitions land and no genie failure logs — never timing.
        schedule(T.min1, 'min1', () => big.minimize());
        schedule(T.res1, 'res1', () => big.present());
        schedule(T.min2, 'min2', () => big.minimize());
        schedule(T.res2, 'res2', () => big.present());
        schedule(T.res2 + 1200, 'close', () => { app.remove_window(big); big.destroy(); });
        schedule(T.res2 + 1700, 'quit', () => app.quit());
        schedule(T.hardStop, 'hard-stop', () => app.quit());
        return;
    }

    schedule(T.maximize, 'big-maximize', () => big.maximize());

    if (MODE === 'fullscreen')
        schedule(T.fullscreen, 'big-fullscreen', () => big.fullscreen());

    if (MODE === 'overlap-only') {
        schedule(T.bigClose - 500, 'close', () => { app.remove_window(big); big.destroy(); });
        schedule(T.quit, 'quit', () => app.quit());
        schedule(T.hardStop, 'hard-stop', () => app.quit());
        return;
    }

    schedule(T.small, 'small-present', () => {
        small = new Gtk.Window({ title: `${PREFIX}-small`, width_request: 380, height_request: 240 });
        app.add_window(small);
        small.set_child(new Gtk.Label({ label: 'small focused window', margin_top: 30, margin_bottom: 30 }));
        small.present();
        // 380x240 is small enough that no placement a compositor will choose puts
        // it over a bottom-docked strip on the same monitor, which is what makes
        // this focus change the discriminant rather than an overlap.
    });
    if (MODE === 'fullscreen') {
        // Reversibility must be driven by a window the harness owns, so the big
        // window dies first and the small one stays mapped. The harness then
        // activates it explicitly and *confirms* focus before asserting — closing
        // the fullscreen window alone lets the compositor hand focus to whatever
        // the user had, and if that window overlaps the dock a correct "stay
        // hidden" would read as a wedge.
        schedule(T.bigClose, 'big-close', () => { app.remove_window(big); big.destroy(); });
        schedule(T.smallClose, 'small-close', () => {
            if (!small) return;
            app.remove_window(small);
            small.destroy();
            small = null;
        });
    } else {
        schedule(T.smallClose, 'small-close', () => {
            if (!small) return;
            app.remove_window(small);
            small.destroy();
            small = null;
        });
        schedule(T.bigClose, 'big-close', () => { app.remove_window(big); big.destroy(); });
    }
    schedule(T.quit, 'quit', () => app.quit());
    schedule(T.hardStop, 'hard-stop', () => app.quit());
});

app.run(null);
