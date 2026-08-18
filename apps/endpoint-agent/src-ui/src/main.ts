import "./styles.css";
import logoUrl from "./workinsight-logo.png";
import { bindSetupForm, type InvokeFn } from "./setup-controller";

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
  }
}

const app = document.getElementById("app")!;
app.innerHTML = `
  <main class="setup">
    <header class="brand">
      <img class="brand__mark" src="${logoUrl}" alt="" width="80" height="80" />
      <div>
        <p class="brand__name">WORKINSIGHT</p>
        <h1>设备接入</h1>
      </div>
    </header>
    <p class="intro">注册后 Agent 将默认驻留后台，运行状态可从菜单栏或系统托盘查看。</p>
    <form id="enroll">
      <label>监控端地址
        <input name="api_url" type="url" placeholder="https://monitor.example.com" required />
      </label>
      <label>一次性注册码
        <input name="code" type="text" required />
      </label>
      <label>设备名称
        <input name="label" type="text" placeholder="办公电脑" />
      </label>
      <button type="submit">注册并开始采集</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
    <p class="scope-note">仅处理公司策略允许的应用与站点域名活动。</p>
  </main>
`;

const invoke: InvokeFn = (command, args) => {
  const bridge = window.__TAURI__?.core.invoke;
  if (!bridge) {
    return Promise.reject(new Error("Tauri bridge unavailable"));
  }
  // Rust enroll still takes `label`; controller/InvokeFn expose deviceLabel.
  return bridge(command, {
    apiUrl: args.apiUrl,
    code: args.code,
    label: args.deviceLabel,
  });
};

bindSetupForm(document, invoke);
