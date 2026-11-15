import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { apply } from "../index.js";

const background = (clientId) => ({
  clientId,
  foreground: false,
  viewingSessionId: null,
  canNotify: true,
  canPage: true,
});

function fixture(implementation = apply) {
  const handlers = new Map();
  const routes = new Map();
  const agents = new Map();
  const cleanups = [];
  let rootOf = (agent) => agent;
  const ctx = {
    inject() {},
    effect(setup) {
      const dispose = setup();
      if (dispose) cleanups.push(dispose);
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    get(name) {
      return name === "subagents" ? { rootOf: (agent) => rootOf(agent) } : undefined;
    },
    agents: { get: (id) => agents.get(id) },
    sessionTitle: { get: () => ({ title: "Example" }) },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route.fetch);
          return () => routes.delete(route.path);
        },
      },
    },
  };
  const config = Object.fromEntries(
    ["systemNotification", "completed", "failed", "approval", "question"].map((key) => [
      key,
      { get: () => true },
    ]),
  );
  implementation(ctx, config);
  return {
    handlers,
    agents,
    async end(session, reason = { kind: "completed" }) {
      handlers.get("session/event")(session, {
        type: "turn/end",
        data: { reason },
      });
      const agent = agents.get(session.id);
      if (agent?.session === session) {
        agent.status = "idle";
        handlers.get("agent/status")({ agent, status: "idle" });
      }
      await Promise.resolve();
    },
    rootResolver(resolve) {
      rootOf = resolve;
    },
    async call(action, data, { cursor, signal } = {}) {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      return routes.get(`/api/local-task-notifications/${action}`)(
        new Request(
          `http://localhost/api/local-task-notifications/${action}${query}`,
          data === undefined ? { signal } : { method: "POST", body: JSON.stringify(data), signal },
        ),
      );
    },
    dispose() {
      for (const close of cleanups.reverse()) close();
    },
  };
}

test("only live runtime roots publish completion; forks remain roots", async () => {
  const f = fixture();
  try {
    const { cursor } = await (await f.call("events")).json();
    const rootSession = { id: "root", header: {} };
    const forkSession = { id: "fork", header: { parentSession: "root" } };
    const root = { id: "root", session: rootSession };
    const childSession = { id: "child", header: { origin: "subagent" } };
    const child = { id: "child", session: childSession };
    const orphanSession = { id: "orphan", header: { origin: "subagent" } };
    f.agents.set("root", root);
    f.agents.set("fork", { id: "fork", session: forkSession });
    f.agents.set("child", child);
    f.agents.set("orphan", { id: "orphan", session: orphanSession });
    f.rootResolver((agent) => {
      if (agent.id === "orphan")
        throw Object.assign(new Error("No owner"), { code: "UNAUTHORIZED" });
      return agent === child ? root : agent;
    });
    const ended = f.handlers.get("session/event");
    const event = { type: "turn/end", data: { reason: { kind: "completed" } } };
    ended(childSession, event);
    ended(orphanSession, event);
    ended({ id: "root", header: {} }, event);
    ended({ id: "preview", header: {} }, event);
    await f.end(forkSession);
    const { events } = await (await f.call("events", undefined, { cursor })).json();
    assert.equal(events.length, 1);
    const [result] = events;
    assert.equal(result.sessionId, "fork");
    assert.match(result.id, /:1$/);
    const firstClaim = await (await f.call("claim", { id: result.id, ...background("a") })).json();
    const duplicateClaim = await (
      await f.call("claim", { id: result.id, ...background("b") })
    ).json();
    assert.deepEqual(firstClaim, { accepted: true, mode: "desktop" });
    assert.deepEqual(duplicateClaim, { accepted: false });
  } finally {
    f.dispose();
  }
});

test("resolved human requests cannot be claimed after delivery", async () => {
  const f = fixture();
  try {
    const { cursor } = await (await f.call("events")).json();
    const observe = f.handlers.get("approval/request");
    const answered = Promise.withResolvers();
    const observation = observe({ agent: { session: { id: "root" } } }, () => answered.promise);
    const {
      events: [result],
    } = await (await f.call("events", undefined, { cursor })).json();
    answered.resolve("allowed");
    await observation;
    assert.deepEqual(await (await f.call("claim", { id: result.id, ...background("a") })).json(), {
      accepted: false,
    });
  } finally {
    f.dispose();
  }
});

test("fresh subscriptions skip old notifications; cursor rotation retains gap events", async () => {
  const f = fixture();
  try {
    const session = { id: "root" };
    f.agents.set(session.id, { id: session.id, session });
    await f.end(session);
    const baseline = await (await f.call("events")).json();
    assert.deepEqual(baseline.events, []);
    await f.end(session);
    await f.end(session);
    const batch = await (await f.call("events", undefined, { cursor: baseline.cursor })).json();
    assert.equal(batch.events.length, 2);
    assert.match(batch.events[0].id, /:2$/);
    assert.match(batch.events[1].id, /:3$/);
    const reconnect = await (await f.call("events")).json();
    assert.deepEqual(reconnect.events, []);
    assert.equal(reconnect.cursor, batch.cursor);
    const replacedHost = await (
      await f.call("events", undefined, { cursor: "old-instance:1" })
    ).json();
    assert.deepEqual(replacedHost.events, []);
  } finally {
    f.dispose();
  }
});

test("idle event requests drain within three seconds for desktop update", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  try {
    const { cursor } = await (await f.call("events")).json();
    let drained = false;
    // Mirrors the updater's pending-request lifetime: request AND response
    // consumption must settle, not only return response headers.
    const pending = f
      .call("events", undefined, { cursor })
      .then((response) => response.json())
      .then((batch) => {
        drained = true;
        return batch;
      });
    t.mock.timers.tick(2999);
    await Promise.resolve();
    assert.equal(drained, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await pending, { cursor, events: [] });
    assert.equal(drained, true);
  } finally {
    f.dispose();
  }
});

test("waiting requests return immediately on new events and close on abort or unload", async () => {
  const f = fixture();
  try {
    const { cursor } = await (await f.call("events")).json();
    const waiting = f.call("events", undefined, { cursor });
    const session = { id: "root" };
    f.agents.set(session.id, { id: session.id, session });
    await f.end(session, { kind: "error", error: { message: "failed" } });
    const batch = await (await waiting).json();
    assert.equal(batch.events[0].kind, "failed");
    const aborted = new AbortController();
    const cancelWait = f.call("events", undefined, {
      cursor: batch.cursor,
      signal: aborted.signal,
    });
    aborted.abort();
    assert.deepEqual((await (await cancelWait).json()).events, []);
    const unloadWait = f.call("events", undefined, { cursor: batch.cursor });
    f.dispose();
    assert.deepEqual((await (await unloadWait).json()).events, []);
  } finally {
    f.dispose();
  }
});

test("one idle outcome covers queued turns; user stop and immediate restart stay silent", async () => {
  const f = fixture();
  try {
    const session = { id: "root" };
    const agent = { id: session.id, session, status: "running" };
    f.agents.set(session.id, agent);
    const { cursor } = await (await f.call("events")).json();
    const ended = f.handlers.get("session/event");
    ended(session, {
      type: "turn/end",
      data: { reason: { kind: "completed" } },
    });
    ended(session, {
      type: "turn/end",
      data: { reason: { kind: "completed" } },
    });
    agent.status = "idle";
    f.handlers.get("agent/status")({ agent, status: "idle" });
    await Promise.resolve();
    const batch = await (await f.call("events", undefined, { cursor })).json();
    assert.equal(batch.events.length, 1);
    await f.end(session, { kind: "aborted", reason: { kind: "user" } });
    ended(session, {
      type: "turn/end",
      data: { reason: { kind: "completed" } },
    });
    f.handlers.get("agent/status")({ agent, status: "idle" });
    agent.status = "running";
    await Promise.resolve();
    assert.equal((await (await f.call("events")).json()).cursor, batch.cursor);
  } finally {
    f.dispose();
  }
});

test("foreground target suppresses all windows; another foreground view owns page delivery", async () => {
  const f = fixture();
  try {
    const session = { id: "root" };
    f.agents.set(session.id, { id: session.id, session });
    const { cursor } = await (await f.call("events")).json();
    await f.end(session);
    const batch = await (await f.call("events", undefined, { cursor })).json();
    const id = batch.events[0].id;
    const front = {
      ...background("front"),
      foreground: true,
      viewingSessionId: "root",
    };
    await f.call("presence", front);
    assert.deepEqual(await (await f.call("claim", { id, ...background("back") })).json(), {
      accepted: false,
      mode: "suppressed",
    });
    front.viewingSessionId = "other";
    await f.call("presence", front);
    await f.end(session);
    const next = (await (await f.call("events", undefined, { cursor: batch.cursor })).json())
      .events[0];
    assert.deepEqual(await (await f.call("claim", { id: next.id, ...background("back") })).json(), {
      accepted: false,
      retryAfterMs: 1000,
    });
    assert.deepEqual(await (await f.call("claim", { id: next.id, ...front })).json(), {
      accepted: true,
      mode: "page",
    });
    assert.deepEqual(await (await f.call("claim", { id: next.id, ...background("back") })).json(), {
      accepted: false,
    });
  } finally {
    f.dispose();
  }
});

test("stale foreground leases expire and concurrent background claims have one winner", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const f = fixture();
  try {
    const session = { id: "root" };
    f.agents.set(session.id, { id: session.id, session });
    await f.call("presence", { ...background("front"), foreground: true });
    const { cursor } = await (await f.call("events")).json();
    await f.end(session);
    const id = (await (await f.call("events", undefined, { cursor })).json()).events[0].id;
    t.mock.timers.tick(10000);
    const claims = await Promise.all(
      ["a", "b"].map(async (clientId) =>
        (await f.call("claim", { id, ...background(clientId) })).json(),
      ),
    );
    assert.equal(claims.filter((claim) => claim.accepted).length, 1);
  } finally {
    f.dispose();
  }
});

function clientFixture(f, options = {}) {
  const cleanups = [];
  const notices = [];
  const opened = [];
  let focusCount = 0;
  let client;
  let runtime;
  let requests = 0;
  let activations = 0;
  let lastSignal;
  let language = options.language ?? "zh";
  let dictionaries;
  const locale = {
    register(_namespace, values) {
      dictionaries = values;
      return () => {};
    },
    bind() {
      return (key, params = {}) => {
        assert.ok(dictionaries[language][key], `Missing ${language} translation: ${key}`);
        return dictionaries[language][key].replace(/\{(\w+)\}/g, (_match, name) =>
          String(params[name]),
        );
      };
    },
    getSnapshot: () => language,
    subscribe: () => () => {},
  };
  const observable = (value) => ({
    getSnapshot: () => value,
    subscribe: () => () => {},
  });
  const preferences = {
    systemNotification: true,
    completed: true,
    failed: true,
    approval: true,
    question: true,
    ...options.preferences,
  };
  class MockNotification {
    static permission = options.permission ?? "granted";
    constructor(title, value) {
      this.title = title;
      this.options = value;
      notices.push(this);
    }
    close() {
      this.onclose?.();
    }
  }
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const context = {
    dshDesktopBoot: options.desktop === false ? undefined : {},
    window: {
      focus() {
        focusCount++;
      },
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: {
        load(definition) {
          client = definition.factory(() => ({ createElement() {} }));
        },
      },
    },
    document: {
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { append() {} },
      visibilityState: "visible",
      hasFocus: () => options.foreground === true,
      querySelector: () => null,
      addEventListener() {},
      removeEventListener() {},
    },
    __DSH_TRANSPORT__: {
      fetch(url, init) {
        const parsed = new URL(url, "http://localhost/");
        const action = parsed.pathname.split("/").at(-1);
        if (action === "activate") activations++;
        if (action === "events") {
          requests++;
          lastSignal = init.signal;
        }
        const cursor = parsed.searchParams.get("cursor") ?? undefined;
        return f.call(action, init.body ? JSON.parse(init.body) : undefined, {
          cursor,
          signal: init.signal,
        });
      },
    },
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto: globalThis.crypto,
    Notification: MockNotification,
    console,
  };
  runInNewContext(source, context);
  client.apply({
    locale,
    configForms: {
      get: () => observable({ status: "ready", value: preferences }),
    },
    layout: { panelInfo: observable({ activePanelId: "conversation" }) },
    uiSession: { current: observable({ key: options.current ?? "other" }) },
    uiWorkspace: {
      async openSession(id) {
        opened.push(id);
      },
    },
    effect(setup) {
      const cleanup = setup();
      if (cleanup) cleanups.push(cleanup);
    },
    slots: {
      inject(_name, setup) {
        setup();
      },
      register(options) {
        runtime = options.inject().runtime;
      },
    },
  });
  return {
    setLanguage(value) {
      language = value;
    },
    translate: locale.bind(),
    runtime,
    notices,
    opened,
    get activations() {
      return activations;
    },
    get focusCount() {
      return focusCount;
    },
    get requests() {
      return requests;
    },
    get lastSignal() {
      return lastSignal;
    },
    dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}

test("client keeps connected state across bounded request rotation and aborts on disposal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  const c = clientFixture(f);
  const runtime = c.runtime;
  const states = [];
  try {
    runtime.subscribe(() => states.push(runtime.getSnapshot().connected));
    await new Promise(setImmediate);
    assert.equal(runtime.getSnapshot().connected, true);
    assert.equal(c.requests, 2);
    t.mock.timers.tick(3000);
    await new Promise(setImmediate);
    assert.equal(c.requests, 3);
    assert.deepEqual(states, [true]);
    c.dispose();
    assert.equal(c.lastSignal.aborted, true);
    await new Promise(setImmediate);
    assert.equal(c.requests, 3);
  } finally {
    c.dispose();
    f.dispose();
  }
});

test("notifications and stored test feedback follow the current DSH language", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  const c = clientFixture(f, { language: "en" });
  try {
    await new Promise(setImmediate);
    const session = { id: "localized" };
    f.agents.set(session.id, { id: session.id, session });
    await f.end(session);
    await new Promise(setImmediate);
    t.mock.timers.tick(100);
    await new Promise(setImmediate);
    assert.equal(c.notices[0].title, "Task completed");
    assert.equal(c.notices[0].options.body, "Example", "user session titles are not translated");
    c.setLanguage("zh");
    await f.end(session);
    await new Promise(setImmediate);
    t.mock.timers.tick(100);
    await new Promise(setImmediate);
    assert.equal(c.notices[1].title, "任务已完成");
    assert.equal(c.translate("title"), "任务通知");
    const testing = c.runtime.test();
    assert.match(c.runtime.getSnapshot().message(), /5 秒/);
    c.setLanguage("en");
    assert.match(c.runtime.getSnapshot().message(), /5 seconds/);
    t.mock.timers.tick(5000);
    await testing;
    assert.equal(c.notices[2].title, "DSH test notification");
    assert.equal(c.notices[2].options.body, "This is a test notification.");
    assert.match(c.runtime.getSnapshot().message(), /System notification requested/);
    c.setLanguage("zh");
    assert.match(c.runtime.getSnapshot().message(), /已请求系统通知/);
  } finally {
    c.dispose();
    f.dispose();
  }
});

test("Web notification navigation does not activate the desktop application", async () => {
  const f = fixture();
  const client = clientFixture(f, { desktop: false });
  try {
    await client.runtime.openSession({
      id: "web-click",
      sessionId: "web-session",
    });
    assert.equal(client.activations, 0);
    assert.equal(client.focusCount, 1);
    assert.deepEqual(client.opened, ["web-session"]);
  } finally {
    client.dispose();
    f.dispose();
  }
});

test("two background clients show one system notification and clicking opens its session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  const clients = [clientFixture(f), clientFixture(f)];
  try {
    await new Promise(setImmediate);
    const session = { id: "notification-target" };
    f.agents.set(session.id, { id: session.id, session });
    await f.end(session);
    await new Promise(setImmediate);
    t.mock.timers.tick(100);
    await new Promise(setImmediate);
    assert.equal(
      clients.reduce((count, c) => count + c.notices.length, 0),
      1,
    );
    const winner = clients.find((c) => c.notices.length);
    winner.notices[0].onclick();
    await new Promise(setImmediate);
    assert.deepEqual(winner.opened, [session.id]);
    assert.equal(winner.focusCount, 1);
    assert.equal(winner.activations, 1);
  } finally {
    for (const c of clients) c.dispose();
    f.dispose();
  }
});

test("foreground other-session view gets a navigable page card, background denied permission keeps a card", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const options of [{ foreground: true }, { permission: "denied" }]) {
    const f = fixture();
    const c = clientFixture(f, options);
    try {
      await new Promise(setImmediate);
      const session = { id: "notification-target" };
      f.agents.set(session.id, { id: session.id, session });
      await f.end(session);
      await new Promise(setImmediate);
      t.mock.timers.tick(100);
      await new Promise(setImmediate);
      assert.equal(c.notices.length, 0);
      assert.equal(c.runtime.getSnapshot().pages.length, 1);
      await c.runtime.openSession(c.runtime.getSnapshot().pages[0]);
      assert.deepEqual(c.opened, [session.id]);
      assert.equal(c.runtime.getSnapshot().pages.length, 0);
    } finally {
      c.dispose();
      f.dispose();
    }
  }
});

function backendWithNativeStub(
  execFile,
  process = { platform: "win32", execPath: "DeepSeek Harness.exe" },
) {
  // Evaluate the same backend with only its native-process boundary replaced.
  // No Windows helper is run, and production code needs no testing-only API.
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?$/gm, "")
    .replace(/export const Config = z\.object\([\s\S]*?\n}\);/, "")
    .replaceAll("export ", "");
  const context = {
    process,
    basename: (path) => path,
    randomUUID: () => "test-host",
    execFile,
    AbortController,
    Response,
    URL,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    console,
  };
  runInNewContext(`${source}\nglobalThis.loadedApply = apply;`, context);
  return context.loadedApply;
}

test("activation uses the fixed Desktop single-instance launch and strips Node mode", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const launches = [];
  const implementation = backendWithNativeStub(
    (file, args, options, callback) => {
      launches.push({ file, args, options, finish: callback });
    },
    {
      platform: "win32",
      execPath: "DeepSeek Harness.exe",
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        Electron_Run_As_Node: "1",
        NODE_OPTIONS: "--require host-hook.js",
        Path: "existing-path",
        DSH_HOME: "existing-profile",
      },
    },
  );
  const f = fixture(implementation);
  try {
    const first = f.call("activate", {
      executable: "other.exe",
      args: ["untrusted"],
    });
    const second = f.call("activate", {});
    await new Promise(setImmediate);
    assert.equal(launches.length, 1);
    const launch = launches[0];
    assert.equal(launch.file, "DeepSeek Harness.exe");
    assert.deepEqual([...launch.args], ["dsh://open"]);
    assert.deepEqual(Object.keys(launch.options.env).sort(), ["DSH_HOME", "Path"]);
    assert.equal(launch.options.env.DSH_HOME, "existing-profile");
    assert.equal(launch.options.timeout, 5000);
    assert.equal(launch.options.windowsHide, true);
    t.mock.timers.tick(2000);
    assert.deepEqual(await (await first).json(), { status: "queued" });
    assert.deepEqual(await (await second).json(), { status: "queued" });
    launch.finish(null);
    await new Promise(setImmediate);
    const completed = f.call("activate", {});
    await new Promise(setImmediate);
    assert.equal(launches.length, 2);
    launches[1].finish(null);
    assert.deepEqual(await (await completed).json(), { status: "requested" });
    f.dispose();
    assert.equal(launch.options.signal.aborted, true);
  } finally {
    f.dispose();
  }
});

test("activation never launches a non-Desktop executable", async () => {
  const f = fixture(
    backendWithNativeStub(
      () => {
        throw new Error("must not launch");
      },
      { platform: "win32", execPath: "node.exe", env: {} },
    ),
  );
  try {
    assert.deepEqual(await (await f.call("activate", {})).json(), {
      status: "unsupported",
    });
  } finally {
    f.dispose();
  }
});
