// LiveRegion — a flicker-free live region at the bottom of the append-scroll
// output, sized to preserve the terminal scrollback above it (the core trick
// behind Claude Code's fluid TUI, adapted to an append-scroll layout).
//
// Model & cursor invariant:
//   • Committed history scrolls normally above the region (plain append).
//   • The region owns the currently-streaming content: every completed
//     content line is appended (terminal scrolls, nothing is ever lost), and
//     one status line always sits on the last line, rewritten in place.
//   • The cursor is ALWAYS at the end of the status line.
//   • Adding a line = overwrite the status line with the new content line,
//     then write the status on the fresh line below (single write, no
//     intermediate clear → no flicker).
//   • The last (partially streamed) content line is rewritten in place as it
//     grows: up one line, rewrite, back down, rewrite the status.
//   • Committing = release(): the region's lines simply become history; the
//     cursor drops to a fresh line below for the next turn.
//
// Long lines are pre-wrapped to the terminal width (segment-aware) so the
// terminal never auto-wraps and breaks the cursor arithmetic.
// A terminal resize erases the region; the next update re-renders it.

import { COLUMNS } from "./ansi.js";

const SGR_RESET = "\x1b[0m";
function sgrFor(attr) {
  if (!attr) return SGR_RESET;
  const p = [];
  if (attr & 1) p.push("1"); // bold
  if (attr & 2) p.push("2"); // dim
  if (attr & 4) p.push("31"); // red
  if (attr & 8) p.push("32"); // green
  if (attr & 16) p.push("33"); // yellow
  if (attr & 32) p.push("36"); // cyan
  if (attr & 64) p.push("35"); // magenta
  if (attr & 128) p.push("34"); // blue
  return "\x1b[" + p.join(";") + "m";
}

export const ATTR = {
  PLAIN: 0,
  BOLD: 1,
  DIM: 2,
  RED: 4,
  GREEN: 8,
  YELLOW: 16,
  CYAN: 32,
  MAGENTA: 64,
  BLUE: 128,
};

/**
 * Word-aware wrap for styled lines.
 * @param {Array<{text: string, attr?: number}>} segments
 * @param {number} width
 * @returns {Array<Array<{text: string, attr?: number}>>} wrapped lines
 */
export function wrapSegments(segments, width) {
  width = Math.max(2, width);
  const lines = [[]];
  let col = 0;
  let pendingSpace = 0; // width of whitespace awaiting a word (dropped on wrap)
  const lastLine = () => lines[lines.length - 1];
  for (const seg of segments || []) {
    const text = String(seg.text ?? "");
    const attr = seg.attr ?? 0;
    // pieces alternate: word, whitespace, word, ...
    for (const piece of text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        // remember; only emitted when a following word lands on this line
        pendingSpace = piece.length;
        continue;
      }
      let w = piece;
      while (w.length) {
        // a pending space only counts when the word isn't starting a fresh line
        const spaceNeeded = col > 0 && pendingSpace ? pendingSpace : 0;
        const room = width - col - spaceNeeded;
        if (w.length <= room) {
          // whole word fits
          if (spaceNeeded) {
            lastLine().push({ text: " ".repeat(spaceNeeded), attr });
            col += spaceNeeded;
          }
          pendingSpace = 0;
          lastLine().push({ text: w, attr });
          col += w.length;
          w = "";
        } else if (w.length > width) {
          // unbreakable: longer than a full line — hard-break it
          if (col > 0 || spaceNeeded) {
            lines.push([]);
            col = 0;
          }
          pendingSpace = 0;
          lastLine().push({ text: w.slice(0, width - col), attr });
          w = w.slice(width - col);
          lines.push([]);
          col = 0;
        } else {
          // breakable word that doesn't fit the remainder — wrap it whole
          lines.push([]);
          col = 0;
          pendingSpace = 0;
        }
      }
    }
  }
  // drop a trailing line that is empty or whitespace-only
  if (lines.length > 1) {
    const tail = lines[lines.length - 1];
    if (!tail.length || tail.every((s) => /^\s*$/.test(s.text))) lines.pop();
  }
  return lines.length ? lines : [[]];
}

function renderLine(segments) {
  let out = "";
  let state = 0;
  for (const seg of segments || []) {
    const a = seg.attr ?? 0;
    if (a !== state) {
      out += sgrFor(a);
      state = a;
    }
    out += String(seg.text ?? "");
  }
  if (state) out += SGR_RESET;
  return out;
}

export class LiveRegion {
  /**
   * @param {(s: string) => void} emit
   * @param {{ maxRows?: number, enabled?: boolean }} opts
   *   maxRows is accepted for API compatibility; the append model keeps every
   *   completed line live (terminal scrollback is the cap), so it is a no-op.
   */
  constructor(emit, { maxRows = 6, enabled = true } = {}) {
    this.emit = emit;
    this.maxRows = maxRows;
    this.enabled = enabled && Boolean(process.stdout.isTTY);
    this.active = false;
    this._rendered = false;
    this._shown = 0; // completed content display lines already written
    this._lastContent = null;
  }

  begin(_opts) {
    this.active = true;
    this._rendered = false;
    this._shown = 0;
    this._lastContent = null;
  }

  get isActive() {
    return this.active;
  }

  /**
   * Update the region.
   * @param {Array<Array<{text, attr?}>>} contentLines styled logical lines —
   *   the full content so far, where the LAST line is the partially streamed
   *   line (grows across calls). Earlier lines are complete.
   * @param {Array<{text, attr?}>|null} status styled status line (last row)
   */
  update(contentLines, status) {
    if (!this.active) return;
    this._lastContent = contentLines;
    const cols = COLUMNS();
    // wrap every logical line into display lines
    const display = [];
    for (const line of contentLines || []) display.push(...wrapSegments(line, cols));
    const statusLine = status ? wrapSegments(status, cols - 1).slice(0, 1)[0] || [] : [];
    const C = display.length;

    if (!this._rendered) {
      // first render: append everything from the current cursor position.
      // The first line is written at the cursor (col 0 of a fresh line, or
      // right after a sameLine header) — no leading newline.
      const rows = [...display, ...(statusLine.length ? [statusLine] : [])];
      let out = "";
      rows.forEach((r, i) => {
        if (i > 0) out += "\n";
        out += renderLine(r) + "\x1b[K";
      });
      if (out) this.emit(out);
      this._rendered = true;
      this._shown = C;
      this._hadStatus = statusLine.length > 0;
      return;
    }

    const newLines = display.slice(this._shown);
    const lastLine = C > 0 ? display[C - 1] : null;
    let out = "";
    if (newLines.length === 0 && C === 0 && !statusLine.length) {
      // nothing to show and nothing stale to clear — but a previously
      // rendered status line must be blanked
      if (this._hadStatus) {
        out = "\x1b[1G\x1b[K";
        this._hadStatus = false;
      }
      if (out) this.emit(out);
      return;
    }
    if (newLines.length > 0) {
      // New completed line(s): the cursor sits at the end of the status line.
      // Overwrite it with the first new line, push the rest below, then write
      // the status on the fresh bottom line. One write, no flicker.
      out += "\x1b[1G";
      for (const nl of newLines) out += renderLine(nl) + "\x1b[K\n";
      if (statusLine.length) out += renderLine(statusLine) + "\x1b[K";
      this._shown = C;
      this._hadStatus = statusLine.length > 0;
    } else if (C > 0 || statusLine.length) {
      // No new lines: the last content line may have grown (or only the
      // status changed). Rewrite the last content line in place, then the
      // status.
      if (C > 0) {
        out += "\x1b[1A\x1b[1G"; // up to the last content line
        out += renderLine(lastLine) + "\x1b[K"; // rewrite it (clear stale tail)
        out += "\n"; // back down to the status line
      } else {
        out += "\x1b[1G";
      }
      out += renderLine(statusLine) + "\x1b[K"; // clears stale status text too
      this._hadStatus = statusLine.length > 0;
    }
    if (out) this.emit(out);
  }

  /** Final update + release; region lines become committed history. */
  end(status) {
    if (!this.active) return;
    if (status) this.update(this._lastContent || [], status);
    this.release();
  }

  /** Release: drop the cursor to a fresh line below; lines become history. */
  release() {
    if (this.active && this._rendered) this.emit("\n");
    this.active = false;
    this._rendered = false;
    this._shown = 0;
  }

  /** Erase the region on terminal resize (stale width would be wrong). */
  eraseOnResize() {
    if (!this.active || !this._rendered) return;
    const h = this._shown + 1; // content lines + status
    const out = ["\x1b[" + Math.max(0, h - 1) + "A", "\x1b[1G"];
    for (let i = 0; i < h; i++) {
      out.push("\x1b[2K");
      if (i < h - 1) out.push("\n");
    }
    // return to the region top so the next update re-renders in place
    out.push("\x1b[" + Math.max(0, h - 1) + "A");
    this.emit(out.join(""));
    this._rendered = false;
    this._shown = 0;
  }
}
