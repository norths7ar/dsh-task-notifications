window.__ModuleLoader__.load({
  id: "dsh-task-notifications",
  factory: (require) => {
    const React = require("react");
    const { Switch, Button, closeTopModal } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const ENTRY = "local-task-notifications";
    const API = "api/local-task-notifications";
    const TITLE_KEYS = {
      completed: "completedTitle",
      failed: "failedTitle",
      approval: "approvalTitle",
      question: "questionTitle",
      test: "testTitle",
    };
    const DICTIONARIES = {
      zh: {
        title: "任务通知",
        completedTitle: "任务已完成",
        failedTitle: "任务执行失败",
        approvalTitle: "有操作等待审批",
        questionTitle: "有问题需要你回答",
        testTitle: "DSH 测试提醒",
        activationError: "窗口唤起失败，请从任务栏打开 DSH。",
        activationHint: "请从任务栏打开 DSH。",
        navigationError: "无法打开通知对应的会话，请从会话列表打开。",
        navigationHint: "无法打开会话，请重试。",
        noChannel: "没有可用的提醒渠道。请检查通知权限，或切到其他应用后再测试。",
        testBody: "这是一条测试提醒。",
        notificationError: "系统通知未能显示，提醒已保留在应用内。",
        notificationRequested: "已请求系统通知",
        notificationFailed: "系统通知发送失败",
        permissionFallback: "系统通知未获授权，已保留页内提醒",
        connectionError: "提醒事件连接不可用",
        testDelay: "5 秒后发送，请切到其他应用观察通知。",
        dismiss: "关闭提醒",
        saveError: "设置未保存，请重试。",
        intro: "正在查看当前会话时不提醒。设置更改后自动保存。",
        unavailable: "插件配置不可用。",
        loading: "正在加载设置…",
        readonly: "当前配置为只读。",
        channels: "提醒方式",
        systemNotification: "系统通知",
        systemDescription: "显示任务结果或待处理事项。",
        events: "提醒内容",
        completed: "任务完成",
        failed: "任务失败",
        approval: "等待审批",
        question: "需要回答问题",
        testing: "正在测试…",
        test: "测试提醒",
        connected: "提醒服务已连接",
        connecting: "正在连接提醒服务…",
        permissionDenied: "系统通知权限已关闭，开启权限后可再次测试。",
        serviceError: "提醒服务返回 {status}",
        testResults: "{results}。请以实际显示为准。",
        separator: "；",
        session: "DSH 会话",
      },
      en: {
        title: "Task notifications",
        completedTitle: "Task completed",
        failedTitle: "Task failed",
        approvalTitle: "Approval needed",
        questionTitle: "Your answer is needed",
        testTitle: "DSH test notification",
        activationError: "Could not bring DSH forward. Open it from the taskbar.",
        activationHint: "Open DSH from the taskbar.",
        navigationError: "Could not open this conversation. Open it from the conversation list.",
        navigationHint: "Could not open the conversation. Try again.",
        noChannel:
          "No notification channel is available. Check notification permission or switch to another app and try again.",
        testBody: "This is a test notification.",
        notificationError:
          "The system notification could not be displayed. The reminder is available in DSH.",
        notificationRequested: "System notification requested",
        notificationFailed: "System notification failed",
        permissionFallback:
          "System notification permission is unavailable; the reminder is available in DSH",
        connectionError: "The notification connection is unavailable",
        testDelay: "Sending in 5 seconds. Switch to another app to check the notification.",
        dismiss: "Dismiss notification",
        saveError: "Settings could not be saved. Try again.",
        intro:
          "No reminders while you are viewing the conversation. Changes are saved automatically.",
        unavailable: "Plugin settings are unavailable.",
        loading: "Loading settings…",
        readonly: "These settings are read-only.",
        channels: "Notification channels",
        systemNotification: "System notifications",
        systemDescription: "Show task results and requests for input.",
        events: "Notify me about",
        completed: "Completed tasks",
        failed: "Failed tasks",
        approval: "Approval requests",
        question: "Questions",
        testing: "Testing…",
        test: "Test notification",
        connected: "Notification service connected",
        connecting: "Connecting to notification service…",
        permissionDenied: "System notifications are blocked. Enable permission to test again.",
        serviceError: "Notification service returned {status}",
        testResults: "{results}. Check the notification to confirm.",
        separator: "; ",
        session: "DSH conversation",
      },
    };
    const CSS = `
      .dtn-settings { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; min-width: 0; }
      .dtn-settings h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }
      .dtn-settings h3 { margin: 24px 0 0; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
      .dtn-settings p { margin: 4px 0 0; }
      .dtn-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .dtn-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 14px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
      .dtn-row > div { min-width: 0; }
      .dtn-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 20px; }
      .dtn-feedback { margin-top: 12px !important; overflow-wrap: anywhere; }
      .dtn-error { color: var(--dsw-alias-state-error-primary); }
      .dtn-toast { position: fixed; right: 24px; bottom: 24px; z-index: 100; width: min(360px, calc(100vw - 48px)); padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-background-primary, Canvas); box-shadow: 0 4px 20px #0002; color: var(--dsw-alias-label-primary); }
      .dtn-toast button { font: inherit; color: inherit; cursor: pointer; }
      .dtn-toast-open { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 0 28px 0 0; }
      .dtn-toast-title { display: block; font-weight: 500; }
      .dtn-toast-body { display: block; margin-top: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .dtn-toast-close { position: absolute; right: 10px; top: 10px; border: 0; border-radius: 6px; background: transparent; width: 28px; height: 28px; }
      .dtn-toast-close:hover { background: var(--dsw-alias-background-hover, #8882); }
    `;

    function createRuntime(ctx, form, t) {
      const listeners = new Set();
      let state = {
        connected: false,
        testing: false,
        message: "",
        error: false,
        pages: [],
      };
      const clientId = globalThis.crypto.randomUUID();
      const lifetime = new AbortController();
      const timers = new Set();
      const notifications = new Set();
      const send =
        globalThis.__DSH_TRANSPORT__?.fetch ?? ((input, init) => globalThis.fetch(input, init));
      const update = (patch) => {
        state = { ...state, ...patch };
        for (const listener of listeners) listener();
      };
      const pause = (ms) =>
        new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            timers.delete(timer);
            lifetime.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, ms);
          timers.add(timer);
          lifetime.signal.addEventListener("abort", finish, { once: true });
          if (lifetime.signal.aborted) finish();
        });
      const request = async (action, data) => {
        const response = await send(`${API}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
          signal: lifetime.signal,
        });
        if (!response.ok) throw new Error(t("serviceError", { status: response.status }));
        return response.json();
      };
      const inForeground = () => document.visibilityState === "visible" && document.hasFocus();
      const viewing = (sessionId) =>
        sessionId !== undefined &&
        inForeground() &&
        (ctx.layout.panelInfo.getSnapshot().activePanelId ?? "conversation") === "conversation" &&
        !document.querySelector('[data-shortcut-modal="settings"]') &&
        ctx.uiSession.current.getSnapshot().key === sessionId;

      const presence = () => {
        const preferences = form.getSnapshot().value ?? {};
        const current = ctx.uiSession.current.getSnapshot().key;
        return {
          clientId,
          foreground: inForeground(),
          viewingSessionId: viewing(current) ? current : null,
          canPage: Boolean(preferences.systemNotification),
          canNotify: Boolean(
            preferences.systemNotification &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted",
          ),
        };
      };
      const heartbeat = () => request("presence", presence()).catch(() => {});
      const dismiss = (id) => update({ pages: state.pages.filter((event) => event.id !== id) });
      const showPage = (event) => {
        if (!state.pages.some((page) => page.id === event.id))
          update({ pages: [...state.pages, event] });
      };
      async function openSession(event) {
        const activation =
          globalThis.dshDesktopBoot !== undefined
            ? request("activate", {}).catch(() => ({ status: "error" }))
            : Promise.resolve({ status: "unsupported" });
        try {
          // Browser focus is useful on Web, but cannot restore the Desktop shell.
          window.focus();
          if (event.sessionId && document.querySelector('[data-shortcut-modal="settings"]'))
            closeTopModal(document);
          if (event.sessionId) await ctx.uiWorkspace.openSession(event.sessionId);
          const result = await activation;
          if (result.status === "error") {
            update({
              message: () => t("activationError"),
              error: true,
            });
            showPage({ ...event, detailKey: "activationHint" });
            return;
          }
          dismiss(event.id);
        } catch {
          update({
            message: () => t("navigationError"),
            error: true,
          });
          showPage({ ...event, detailKey: "navigationHint" });
        }
      }

      async function deliver(event, test = false) {
        if (lifetime.signal.aborted) return;
        const eligibility = () => {
          const snapshot = form.getSnapshot();
          if (snapshot.status !== "ready" || lifetime.signal.aborted) return null;
          const preferences = snapshot.value;
          if (!test && (!preferences[event.kind] || viewing(event.sessionId))) return null;
          return {
            preferences,
            canNotify:
              preferences.systemNotification &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted",
          };
        };
        let eligible = eligibility();
        if (!eligible) return;
        if (!eligible.preferences.systemNotification) {
          if (test)
            update({
              message: () => t("noChannel"),
              error: true,
            });
          return;
        }
        let mode = inForeground() ? "page" : "desktop";
        if (!test) {
          // Give focus/visibility events a chance to publish before arbitration.
          await pause(100);
          let claim;
          for (let attempt = 0; attempt < 13 && !lifetime.signal.aborted; attempt++) {
            claim = await request("claim", { id: event.id, ...presence() });
            if (claim.accepted || !claim.retryAfterMs) break;
            await pause(claim.retryAfterMs);
          }
          if (lifetime.signal.aborted) return;
          if (!claim.accepted) return;
          mode = claim.mode;
          eligible = eligibility();
          if (!eligible) return;
        }
        const { preferences, canNotify } = eligible;
        const results = [];
        if (!test && mode === "page") {
          showPage(event);
          return;
        }
        if (canNotify) {
          try {
            const notice = new Notification(t(TITLE_KEYS[event.kind]), {
              body: test
                ? t("testBody")
                : [event.title || t("session"), event.detailKey ? t(event.detailKey) : event.detail]
                    .filter(Boolean)
                    .join("\n"),
              tag: event.id,
            });
            notifications.add(notice);
            notice.onclose = () => notifications.delete(notice);
            notice.onclick = () => {
              void openSession(event);
              notice.close();
            };
            notice.onerror = () => {
              showPage(event);
              update({
                message: () => t("notificationError"),
                error: true,
              });
            };
            results.push("notificationRequested");
          } catch {
            showPage(event);
            results.push("notificationFailed");
          }
        } else if (preferences.systemNotification) {
          showPage(event);
          results.push("permissionFallback");
        }
        if (test)
          update({
            message: () =>
              t("testResults", { results: results.map((key) => t(key)).join(t("separator")) }),
            error: false,
          });
      }

      async function listen() {
        let cursor;
        while (!lifetime.signal.aborted) {
          try {
            const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
            const response = await send(`${API}/events${query}`, {
              signal: lifetime.signal,
            });
            if (!response.ok) throw new Error(t("connectionError"));
            const batch = await response.json();
            cursor = batch.cursor;
            if (!state.connected && !lifetime.signal.aborted) update({ connected: true });
            for (const event of batch.events) {
              if (!TITLE_KEYS[event.kind]) continue;
              try {
                void deliver(event).catch((error) => {
                  if (!lifetime.signal.aborted) console.warn("[task-notifications]", error.message);
                });
              } catch (error) {
                if (!lifetime.signal.aborted) update({ message: error.message, error: true });
              }
            }
          } catch (error) {
            if (!lifetime.signal.aborted) console.warn("[task-notifications]", error.message);
            // A real reconnect starts a fresh live subscription, like the old
            // SSE channel; successful bounded request rotation keeps its cursor.
            cursor = undefined;
            update({ connected: false });
            if (!lifetime.signal.aborted) await pause(3000);
          }
        }
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        dismiss,
        openSession,
        start() {
          void heartbeat();
          const heartbeatTimer = setInterval(heartbeat, 3000);
          window.addEventListener("focus", heartbeat);
          window.addEventListener("blur", heartbeat);
          document.addEventListener("visibilitychange", heartbeat);
          const subscriptions = [ctx.uiSession.current, ctx.layout.panelInfo, form].map((store) =>
            store.subscribe(heartbeat),
          );
          void listen();
          return () => {
            clearInterval(heartbeatTimer);
            window.removeEventListener("focus", heartbeat);
            window.removeEventListener("blur", heartbeat);
            document.removeEventListener("visibilitychange", heartbeat);
            for (const unsubscribe of subscriptions) unsubscribe();
            // Do not reuse the soon-to-be-aborted lifetime signal for departure.
            void send(`${API}/presence`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ clientId, remove: true }),
            }).catch(() => {});
            lifetime.abort();
            for (const timer of timers) clearTimeout(timer);
            for (const notice of notifications) notice.close();
          };
        },
        async test() {
          if (state.testing) return;
          update({ testing: true, message: "", error: false });
          try {
            if (
              form.getSnapshot().value?.systemNotification &&
              typeof Notification !== "undefined" &&
              Notification.permission === "default"
            ) {
              await Notification.requestPermission();
            }
            update({ message: () => t("testDelay") });
            await pause(5000);
            if (!lifetime.signal.aborted)
              await deliver({ kind: "test", id: `dtn-test-${Date.now()}` }, true);
          } catch (error) {
            if (!lifetime.signal.aborted) update({ message: error.message, error: true });
          } finally {
            update({ testing: false });
          }
        },
      };
    }

    function NotificationCard({ runtime, locale, t }) {
      useLocale(locale);
      const snapshot = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
      const event = snapshot.pages[0];
      if (!event) return null;
      return h(
        "aside",
        { className: "dtn-toast", role: "status", "aria-live": "polite" },
        h(
          "button",
          {
            className: "dtn-toast-open",
            onClick: () => void runtime.openSession(event),
          },
          h("span", { className: "dtn-toast-title" }, t(TITLE_KEYS[event.kind])),
          h(
            "span",
            { className: "dtn-toast-body" },
            [event.title || t("session"), event.detailKey ? t(event.detailKey) : event.detail]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
        h(
          "button",
          {
            className: "dtn-toast-close",
            "aria-label": t("dismiss"),
            onClick: () => runtime.dismiss(event.id),
          },
          "×",
        ),
      );
    }

    function Settings({ form, runtime, locale, t }) {
      useLocale(locale);
      const subscribe = React.useCallback((listener) => form.subscribe(listener), [form]);
      const read = React.useCallback(() => form.getSnapshot(), [form]);
      const snapshot = React.useSyncExternalStore(subscribe, read);
      const status = React.useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
      const [saving, setSaving] = React.useState(null);
      const [error, setError] = React.useState("");
      const ready = snapshot.status === "ready";
      const disabled = !ready || !snapshot.writable || saving !== null;
      async function change(field, value) {
        setSaving(field);
        setError("");
        try {
          if (
            field === "systemNotification" &&
            value &&
            typeof Notification !== "undefined" &&
            Notification.permission === "default"
          ) {
            await Notification.requestPermission();
          }
          if (!(await form.set(field, value))) setError("saveError");
        } catch {
          setError("saveError");
        } finally {
          setSaving(null);
        }
      }
      function row(field, label, description) {
        return h(
          "div",
          { className: "dtn-row", key: field },
          h(
            "div",
            null,
            h("div", null, label),
            description && h("p", { className: "dtn-muted" }, description),
          ),
          h(Switch, {
            checked: snapshot.value?.[field] ?? false,
            disabled,
            label,
            onChange: (value) => change(field, value),
          }),
        );
      }
      return h(
        "section",
        { className: "dtn-settings", "aria-label": t("title") },
        h("h2", null, t("title")),
        h("p", { className: "dtn-muted" }, t("intro")),
        !ready &&
          h(
            "p",
            { role: "status" },
            snapshot.status === "unavailable" ? t("unavailable") : t("loading"),
          ),
        ready && !snapshot.writable && h("p", { role: "status" }, t("readonly")),
        h("h3", null, t("channels")),
        row("systemNotification", t("systemNotification"), t("systemDescription")),
        h("h3", null, t("events")),
        row("completed", t("completed")),
        row("failed", t("failed")),
        row("approval", t("approval")),
        row("question", t("question")),
        h(
          "div",
          { className: "dtn-footer" },
          h(
            Button,
            {
              variant: "outline",
              disabled: !ready || status.testing || !snapshot.value?.systemNotification,
              onClick: () => runtime.test(),
            },
            status.testing ? t("testing") : t("test"),
          ),
          h(
            "span",
            { className: "dtn-muted", role: "status" },
            status.connected ? t("connected") : t("connecting"),
          ),
        ),
        typeof Notification !== "undefined" &&
          Notification.permission === "denied" &&
          h("p", { className: "dtn-muted dtn-feedback" }, t("permissionDenied")),
        (error || status.message) &&
          h(
            "p",
            {
              className: `dtn-feedback ${error || status.error ? "dtn-error" : "dtn-muted"}`,
              role: error || status.error ? "alert" : "status",
            },
            error
              ? t(error)
              : typeof status.message === "function"
                ? status.message()
                : status.message,
          ),
      );
    }

    function useLocale(locale) {
      const source = React.useMemo(
        () => ({
          subscribe: (listener) => locale.subscribe(listener),
          getSnapshot: () => locale.getSnapshot(),
        }),
        [locale],
      );
      React.useSyncExternalStore(source.subscribe, source.getSnapshot);
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(ENTRY, DICTIONARIES),
        "task-notifications: translations",
      );
      const t = ctx.locale.bind(ENTRY);
      const form = ctx.configForms.get(ENTRY);
      const runtime = createRuntime(ctx, form, t);
      ctx.effect(() =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: `${ENTRY}-notifications`,
            inject: () => ({ runtime, locale: ctx.locale, t }),
          },
          NotificationCard,
        ),
      );
      ctx.effect(() => runtime.start(), "task-notifications: live reminders");
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.pluginCss = "dsh-task-notifications/client";
        tag.textContent = CSS;
        document.head.append(tag);
        return () => tag.remove();
      });
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: ENTRY,
            order: 40,
            label: () => t("title"),
            inject: () => ({ form, runtime, locale: ctx.locale, t }),
          },
          Settings,
        ),
      );
    }
    return {
      apply,
      inject: ["slots", "configForms", "layout", "uiSession", "uiWorkspace", "locale"],
    };
  },
});
