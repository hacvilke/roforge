// Local Studio bridge: a tiny HTTP server on 127.0.0.1 that the RoForge
// Bridge plugin (installed in Studio) polls for commands.
//
// Protocol (see docs/BRIDGE.md):
//   GET  /v1/bridge/ping                  → {ok, time}
//   GET  /v1/bridge/jobs                  → {jobs: [ ...pending ]}  (first job is claimed)
//   POST /v1/bridge/jobs/:id/result       → {ok}
// Auth: Authorization: Bearer <bridge token> (loopback-only by design).
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { json } from "./wire.js";

export class BridgeServer {
  constructor({ port, host = "127.0.0.1", token, jobTimeoutMs = 60000, completedTtlMs = 30000 }) {
    this.port = port;
    this.host = host;
    this.token = token;
    this.jobTimeoutMs = jobTimeoutMs;
    this.completedTtlMs = completedTtlMs;
    this.jobs = new Map(); // id → {id, tool, args, status, resolve, timer}
    this.lastPingAt = null;
    this.lastSeenAt = null;
    this.nextJobId = 1;
    this.server = null;
    this.onEvent = null; // (kind, payload) hook for UI
  }

  get connected() {
    return this.lastSeenAt !== null && Date.now() - this.lastSeenAt < 10_000;
  }
  get lastSeen() {
    return this.lastSeenAt;
  }

  start() {
    this.server = http.createServer((req, res) => this._handle(req, res));
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        const { port } = this.server.address();
        this.port = port;
        resolve(this);
      });
    });
  }

  stop() {
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      if (typeof job.resolve === "function") job.resolve({ ok: false, error: "bridge shut down" });
    }
    this.jobs.clear();
    if (this.server) {
      const s = this.server;
      this.server = null;
      s.close();
    }
  }

  _authorized(req) {
    const h = String(req.headers["authorization"] || "");
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return false;
    // Constant-time compare (defence in depth; the server is loopback-only).
    const given = m[1].trim();
    const a = Buffer.from(given);
    const b = Buffer.from(this.token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  _handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const emit = (kind, payload) => this.onEvent && this.onEvent(kind, payload);

    try {
      if (req.method === "GET" && path === "/health") {
        return json(res, 200, { ok: true, service: "roforge-bridge", connected: this.connected, port: this.port });
      }
      if (!this._authorized(req)) {
        return json(res, 401, { error: "unauthorized — use the token printed by roforge (or `roforge studio`)", code: "UNAUTHORIZED" });
      }
      this.lastSeenAt = Date.now();

      if (req.method === "GET" && path === "/v1/bridge/ping") {
        this.lastPingAt = Date.now();
        emit("connected", this.lastPingAt);
        return json(res, 200, { ok: true, time: new Date().toISOString(), jobsPending: this.jobs.size });
      }

      if (req.method === "GET" && path === "/v1/bridge/jobs") {
        // claim the first pending job (FIFO)
        for (const job of this.jobs.values()) {
          if (job.status === "pending") {
            job.status = "claimed";
            job.claimedAt = Date.now();
            emit("job_claimed", job);
            return json(res, 200, { jobs: [{ id: job.id, tool: job.tool, args: job.args }] });
          }
        }
        return json(res, 200, { jobs: [] });
      }

      const m = /^\/v1\/bridge\/jobs\/(\w+)\/result$/.exec(path);
      if (req.method === "POST" && m) {
        const job = this.jobs.get(m[1]);
        if (!job) return json(res, 404, { error: "unknown job", code: "JOB_NOT_FOUND" });
        let body = {};
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
          size += c.length;
          // 16MB cap: a 1024x576 viewport PNG is ~3MB in base64 inside JSON.
          if (size < 16 * 1024 * 1024) chunks.push(c);
        });
        req.on("end", () => {
          try {
            body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          } catch {
            body = { error: "bad json" };
          }
          clearTimeout(job.timer);
          const out = body.error ? { ok: false, error: body.error } : { ok: true, result: body.result ?? "" };
          job.status = "done";
          job.out = out;
          if (typeof job.resolve === "function") job.resolve(out);
          this._retire(job);
          emit("job_done", { id: job.id, ...out });
          json(res, 200, { ok: true });
        });
        return;
      }

      // Enqueue a job from an authenticated client (used by `roforge pro`
      // attaching to an already-running bridge). The plugin still discovers
      // it via the normal GET /jobs claim path.
      if (req.method === "POST" && path === "/v1/bridge/jobs/enqueue") {
        let body = {};
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
          size += c.length;
          if (size < 1024 * 1024) chunks.push(c);
        });
        req.on("end", () => {
          try {
            body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          } catch {
            body = {};
          }
          if (typeof body.tool !== "string" || !body.tool) {
            return json(res, 400, { error: "missing tool", code: "BAD_REQUEST" });
          }
          const id = this.enqueueRemote(body.tool, body.args ?? {});
          json(res, 200, { ok: true, id });
        });
        return;
      }

      // Poll a (possibly completed) job's status — read by an attaching client.
      const gs = /^\/v1\/bridge\/jobs\/(\w+)$/.exec(path);
      if (req.method === "GET" && gs) {
        const st = this.jobStatus(gs[1]);
        if (!st) return json(res, 404, { error: "unknown job", code: "JOB_NOT_FOUND" });
        return json(res, 200, { ok: true, ...st });
      }

      return json(res, 404, { error: `no route: ${req.method} ${path}`, code: "NOT_FOUND" });
    } catch (e) {
      json(res, 500, { error: e.message, code: "INTERNAL" });
    }
  }

  // Keep a finished job readable for a short window (so an attaching client
  // can poll its result), then drop it. Unref'd: housekeeping must not keep
  // the CLI process (or test runner) alive.
  _retire(job) {
    const t = setTimeout(() => {
      if (this.jobs.get(job.id) === job) this.jobs.delete(job.id);
    }, this.completedTtlMs);
    if (typeof t.unref === "function") t.unref();
  }

  // Enqueue a job on behalf of a remote (attaching) client. Returns the id to
  // poll. The plugin claims it through the normal GET /jobs path.
  enqueueRemote(tool, args, { timeoutMs = this.jobTimeoutMs } = {}) {
    const id = `job_${this.nextJobId++}`;
    const job = { id, tool, args, status: "pending", remote: true, out: null, resolve: null, claimedAt: null, timer: null };
    job.timer = setTimeout(() => {
      if (this.jobs.get(id) === job && job.status !== "done") {
        job.status = "timeout";
        job.out = { ok: false, error: `studio job timed out after ${Math.round(timeoutMs / 1000)}s` };
        this._retire(job);
      }
    }, timeoutMs);
    this.jobs.set(id, job);
    return id;
  }

  // Current status of a job for a poller: {id, status} while in flight, or
  // {id, status:"done"|"timeout", ...out} once finished. null if unknown.
  jobStatus(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === "pending" || job.status === "claimed") return { id, status: job.status };
    return { id, status: job.status, ...(job.out || {}) };
  }

  // Submit a tool job and wait for the plugin's result. Resolves to
  // {ok:true, result:string} or {ok:false, error:string}.
  submit(tool, args, { timeoutMs = this.jobTimeoutMs } = {}) {
    return new Promise((resolve) => {
      if (!this.connected) {
        return resolve({
          ok: false,
          error:
            "Studio bridge is not connected. Open Roblox Studio with the RoForge Bridge plugin active " +
            `(bridge: http://${this.host}:${this.port}).`,
        });
      }
      const id = `job_${this.nextJobId++}`;
      const job = { id, tool, args, status: "pending", resolve, claimedAt: null, timer: null };
      job.timer = setTimeout(() => {
        if (this.jobs.get(id) === job) {
          this.jobs.delete(id);
          job.resolve({ ok: false, error: `studio job timed out after ${Math.round(timeoutMs / 1000)}s` });
        }
      }, timeoutMs);
      this.jobs.set(id, job);
    });
  }
}
