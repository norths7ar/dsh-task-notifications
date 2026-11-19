import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import z from "@deepseek-ai/schemastery";

export const name = "task-notifications";
export const inject = ["sessions", "agents", "sessionTitle", "connection"];
export const Config = z.object({
  systemNotification: z.boolean().default(true).volatile(),
  completed: z.boolean().default(true).volatile(),
  failed: z.boolean().default(true).volatile(),
  approval: z.boolean().default(true).volatile(),
  question: z.boolean().default(true).volatile(),
  background: z.boolean().default(false).volatile(),
});

const API = "/api/local-task-notifications";
const compact = (text, limit) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

export function apply(ctx, config) {
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  const lifetime = new AbortController();
  const waiters = new Set();
  const pending = new Map();
  const clients = new Map();
  const outcomes = new WeakMap();
  const goalChanges = new WeakMap();
  const reportedGoals = new WeakMap();
  const settledGoalTurns = new WeakSet();
  const goalTurns = new WeakSet();
  const settling = new WeakSet();
  const continuedQuestions = new Map();
  const activeRequests = new Set();
  const jobBatches = new Map();
  const instance = randomUUID();
  let sequence = 0;
  let activationInFlight;

  function enabled(kind) {
    const preference =
      {
        goalCompleted: "completed",
        goalBlocked: "failed",
        jobCompleted: "background",
        jobFailed: "background",
      }[kind] ?? kind;
    return config[preference]?.get() === true;
  }

  function record(event) {
    event.id = `${instance}:${++sequence}`;
    pending.set(event.id, { event, sequence, claimedBy: null });
    // Only a short-lived delivery ledger, never a copy of chat history.
    if (pending.size > 256) pending.delete(pending.keys().next().value);
    for (const finish of [...waiters]) finish();
    return event.id;
  }

  function publish(kind, session, detail = "", count) {
    if (!enabled(kind) || lifetime.signal.aborted) return;
    const event = {
      kind,
      sessionId: session?.id,
      title: compact(session && ctx.sessionTitle.get(session)?.title, 100),
      detail: compact(detail, 160),
      ...(count === undefined ? {} : { count }),
    };
    return record(event);
  }

  function withdraw(id) {
    if (!id || !activeRequests.delete(id)) return;
    pending.delete(id);
    continuedQuestions.delete(id);
    if (!lifetime.signal.aborted) record({ action: "dismiss", targetId: id });
  }

  function pruneQuestions() {
    for (const [id, active] of continuedQuestions) {
      if (!active()) withdraw(id);
    }
  }

  function clearJobs(sessionId) {
    const batch = jobBatches.get(sessionId);
    if (batch) clearTimeout(batch.timer);
    jobBatches.delete(sessionId);
  }

  function flushJobs(sessionId) {
    const batch = jobBatches.get(sessionId);
    if (!batch) return;
    const agent = ctx.agents.get(sessionId);
    if (!agent || rootAgent(agent.session) !== agent || !enabled("jobCompleted")) {
      clearJobs(sessionId);
      return;
    }
    if (agent.status !== "idle") return;
    clearJobs(sessionId);
    const jobs = [...batch.jobs.values()];
    publish(
      jobs.some((job) => job.status === "failed") ? "jobFailed" : "jobCompleted",
      agent.session,
      jobs.map((job) => job.label || job.id).join(" · "),
      jobs.length,
    );
  }

  function settle(agent) {
    if (settling.has(agent)) return;
    settling.add(agent);
    queueMicrotask(() => {
      settling.delete(agent);
      if (lifetime.signal.aborted || agent.status !== "idle" || rootAgent(agent.session) !== agent)
        return;
      const reason = outcomes.get(agent);
      outcomes.delete(agent);
      const terminal = goalChanges.get(agent);
      goalChanges.delete(agent);
      const goal = ctx.get("goals")?.get(agent);
      let published;
      if (terminal && (!goal || (goal.id === terminal.id && goal.revision === terminal.revision))) {
        reportedGoals.set(agent, `${terminal.id}:${terminal.revision}`);
        settledGoalTurns.add(agent);
        published = publish(
          terminal.phase === "complete" ? "goalCompleted" : "goalBlocked",
          agent.session,
          terminal.blockedReason?.message || terminal.objective,
        );
      } else if (reason?.kind === "error") {
        published = publish("failed", agent.session, reason.error?.message);
      } else if (
        reason?.kind === "completed" &&
        !settledGoalTurns.has(agent) &&
        goal?.phase !== "active" &&
        !(goal?.phase === "paused" && goalTurns.has(agent))
      ) {
        published = publish("completed", agent.session);
      }
      if (published) clearJobs(agent.session.id);
      else {
        const batch = jobBatches.get(agent.session.id);
        if (batch) {
          clearTimeout(batch.timer);
          batch.timer = setTimeout(() => flushJobs(agent.session.id), 1000);
        }
      }
    });
  }

  function rootAgent(session) {
    // Only the exact registered session can produce a new task result. A
    // detached preview or a replayed seed is not a user-facing completion.
    const agent = ctx.agents.get(session.id);
    if (!agent || agent.session !== session) return null;
    const subagents = ctx.get("subagents");
    if (subagents) {
      try {
        if (subagents.rootOf(agent) !== agent) return null;
      } catch (error) {
        // Delegated sessions without a live owner are not independent roots.
        if (error.code === "UNAUTHORIZED") return null;
        throw error;
      }
    }
    return agent;
  }

  ctx.on(
    "session/event",
    (session, event) => {
      const agent = rootAgent(session);
      if (!agent) return;
      if (event.type === "user/message") {
        settledGoalTurns.delete(agent);
        if (event.data.source?.kind === "goal") goalTurns.add(agent);
        else goalTurns.delete(agent);
      }
      if (event.type === "turn/end") outcomes.set(agent, event.data.reason);
    },
    { global: true },
  );

  ctx.on(
    "agent/status",
    ({ agent, status }) => {
      if (status !== "idle") return;
      settle(agent);
    },
    { global: true },
  );

  ctx.on(
    "goal/changed",
    ({ agent, change }) => {
      if (rootAgent(agent.session) !== agent) return;
      const goal = change.goal;
      if (goal?.phase === "complete" || goal?.phase === "blocked") {
        if (!["complete", "block"].includes(change.operation)) {
          const terminal = goalChanges.get(agent);
          if (terminal?.id === goal.id && terminal.phase === goal.phase)
            goalChanges.set(agent, goal);
          return;
        }
        if (reportedGoals.get(agent) === `${goal.id}:${goal.revision}`) return;
        goalChanges.set(agent, goal);
        if (agent.status === "idle") settle(agent);
      } else {
        goalChanges.delete(agent);
        if (change.operation === "pause") goalTurns.add(agent);
      }
    },
    { global: true },
  );

  ctx.on("agent/disposed", ({ agent }) => clearJobs(agent.session.id), { global: true });

  ctx.inject(["jobs"], (child) => {
    child.jobs.events.subscribe({ owners: "scope" }, (event) => {
      if (
        event.type !== "settled" ||
        event.awaited ||
        event.cause === "teardown" ||
        !["completed", "failed"].includes(event.job.status) ||
        !enabled("jobCompleted")
      )
        return;
      const agent = ctx.agents.get(event.job.owner);
      if (!agent || rootAgent(agent.session) !== agent) return;
      let batch = jobBatches.get(agent.session.id);
      if (!batch) {
        batch = { jobs: new Map(), timer: undefined };
        jobBatches.set(agent.session.id, batch);
      }
      batch.jobs.set(event.job.id, event.job);
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => flushJobs(agent.session.id), 1000);
    });
  });

  async function observeRequest(kind, request, next) {
    if (request.signal?.aborted) return next();
    const session = request.agent?.session;
    let id;
    try {
      id = publish(kind, session);
      if (id) activeRequests.add(id);
    } catch (error) {
      console.warn("[task-notifications] Could not publish reminder:", error.message);
    }
    // This observer never answers or delays the human-interaction waterfall.
    // An answered/cancelled request cannot be claimed later by a slow client.
    let continued = false;
    const timedOut = () =>
      kind === "question" &&
      request.wait?.timed &&
      request.signal?.reason?.code === "ASK_TIMED_OUT";
    const onAbort = () => {
      // A timed wait aborts its signal to release the model, but the question
      // remains answerable. Only its projection tells us when it is settled.
      if (!timedOut()) withdraw(id);
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    try {
      return await next();
    } catch (error) {
      continued =
        timedOut() ||
        (kind === "question" && request.wait?.timed && error?.code === "ASK_TIMED_OUT");
      if (continued && id && (!request.signal?.aborted || timedOut())) {
        const active = () =>
          ctx
            .get("sessionProjections")
            ?.stateOf(session, "userQuestions")
            ?.questions.active.some((question) => question.callId === request.wait.callId) === true;
        const entry = pending.get(id);
        if (entry) entry.stillPending = active;
        continuedQuestions.set(id, active);
      }
      throw error;
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
      if (id && !continued) withdraw(id);
    }
  }
  ctx.on("approval/request", (request, next) => observeRequest("approval", request, next), {
    prepend: true,
    global: true,
  });
  ctx.on("user-questions/request", (request, next) => observeRequest("question", request, next), {
    prepend: true,
    global: true,
  });

  async function events(request) {
    pruneQuestions();
    const cursor = new URL(request.url).searchParams.get("cursor");
    const prefix = `${instance}:`;
    const after = cursor?.startsWith(prefix) ? Number(cursor.slice(prefix.length)) : NaN;
    const continuing = Number.isSafeInteger(after) && after >= 0 && after <= sequence;
    const collect = () =>
      continuing
        ? [...pending.values()]
            .filter((entry) => entry.sequence > after)
            .map((entry) => entry.event)
        : [];
    // A fresh page or a restarted Host begins live-only. During normal request
    // rotation, the cursor retains events arriving between two HTTP requests.
    if (
      continuing &&
      collect().length === 0 &&
      !request.signal.aborted &&
      !lifetime.signal.aborted
    ) {
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          waiters.delete(finish);
          request.signal.removeEventListener("abort", finish);
          resolve();
        };
        // Desktop update locks admission and drains HTTP requests. Every wait
        // ends well inside its 10-second deadline, even when no event arrives.
        const timer = setTimeout(finish, 3000);
        waiters.add(finish);
        request.signal.addEventListener("abort", finish, { once: true });
        if (request.signal.aborted) finish();
      });
    }
    pruneQuestions();
    return Response.json(
      {
        cursor: `${instance}:${sequence}`,
        events: collect(),
        activeRequestIds: [...activeRequests],
      },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  }

  async function boundedResult(request, operation) {
    let timer;
    let onAbort;
    const deadline = new Promise((resolve) => {
      onAbort = () => resolve({ status: "queued" });
      timer = setTimeout(onAbort, 2000);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) onAbort();
    });
    try {
      return await Promise.race([operation, deadline]);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
    }
  }

  function activateDesktop() {
    if (
      process.platform !== "win32" ||
      !/^DeepSeek Harness\.exe$/i.test(basename(process.execPath))
    )
      return Promise.resolve({ status: "unsupported" });
    if (lifetime.signal.aborted) return Promise.resolve({ status: "disposed" });
    if (activationInFlight) return activationInFlight;
    // rc.3 exposes no renderer focus bridge. A second Desktop launch takes its
    // existing single-instance path: restore/show/focus the primary window.
    // The plugin host itself runs Electron in Node mode; never inherit that
    // switch (or Node startup hooks) into the GUI activation process.
    const env = Object.fromEntries(
      Object.entries(process.env ?? {}).filter(
        ([key]) => !["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key.toUpperCase()),
      ),
    );
    activationInFlight = new Promise((resolve) => {
      execFile(
        process.execPath,
        ["dsh://open"],
        {
          env,
          windowsHide: true,
          signal: lifetime.signal,
          timeout: 5000,
        },
        (error) => {
          if (error && !lifetime.signal.aborted)
            console.warn("[task-notifications] Desktop activation failed:", error.message);
          resolve({ status: error ? "error" : "requested" });
        },
      );
    }).finally(() => {
      activationInFlight = undefined;
    });
    return activationInFlight;
  }

  function route(path, methods, fetch) {
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `${API}/${path}`,
        methods,
        requestBody: "buffered",
        fetch,
      }),
    );
  }
  route("events", ["GET"], events);
  // The route accepts no executable, arguments or URL supplied by a client.
  route("activate", ["POST"], async (request) =>
    Response.json(await boundedResult(request, activateDesktop())),
  );
  function presence(data) {
    if (typeof data?.clientId !== "string" || !data.clientId || data.clientId.length > 100)
      return false;
    if (data.remove === true) clients.delete(data.clientId);
    else
      clients.set(data.clientId, {
        seen: Date.now(),
        foreground: data.foreground === true,
        viewingSessionId: typeof data.viewingSessionId === "string" ? data.viewingSessionId : null,
        canPage: data.canPage === true,
        canNotify: data.canNotify === true,
      });
    for (const [id, client] of clients) {
      if (Date.now() - client.seen >= 10000) clients.delete(id);
    }
    return true;
  }
  route("presence", ["POST"], async (request) => {
    let data;
    try {
      data = await request.json();
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    return presence(data)
      ? Response.json({ ok: true })
      : Response.json({ error: "Invalid client" }, { status: 400 });
  });
  route("claim", ["POST"], async (request) => {
    let data;
    try {
      data = await request.json();
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!presence(data)) return Response.json({ accepted: false });
    pruneQuestions();
    const entry = pending.get(data?.id);
    if (
      !entry ||
      entry.claimedBy !== null ||
      entry.event.action === "dismiss" ||
      !enabled(entry.event.kind) ||
      !(entry.stillPending?.() ?? true)
    )
      return Response.json({ accepted: false });
    const caller = clients.get(data.clientId);
    if (!caller) return Response.json({ accepted: false });
    const foreground = [...clients.values()].filter((client) => client.foreground);
    if (foreground.some((client) => client.viewingSessionId === entry.event.sessionId)) {
      entry.claimedBy = "suppressed";
      return Response.json({ accepted: false, mode: "suppressed" });
    }
    const pageEligible = config.systemNotification.get() && caller.canPage && caller.foreground;
    if (
      !pageEligible &&
      config.systemNotification.get() &&
      foreground.some((client) => client.canPage)
    )
      return Response.json({ accepted: false, retryAfterMs: 1000 });
    const desktopEligible =
      !caller.foreground && config.systemNotification.get() && (caller.canNotify || caller.canPage);
    if (!pageEligible && !desktopEligible) return Response.json({ accepted: false });
    entry.claimedBy = data.clientId;
    return Response.json({ accepted: true, mode: pageEligible ? "page" : "desktop" });
  });
  ctx.effect(() => () => {
    lifetime.abort();
    for (const finish of [...waiters]) finish();
    pending.clear();
    continuedQuestions.clear();
    activeRequests.clear();
    for (const sessionId of jobBatches.keys()) clearJobs(sessionId);
    clients.clear();
  });
}
