import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bindSetupForm, type InvokeFn } from "../src/setup-controller";

/** Minimal fixture using the production form IDs/names from main.ts markup. */
function mountSetupFixture(): Document {
  document.body.innerHTML = `
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
  `;
  return document;
}

function fillValidFields(): void {
  const form = document.getElementById("enroll") as HTMLFormElement;
  (form.querySelector('input[name="api_url"]') as HTMLInputElement).value =
    "https://monitor.example.com";
  (form.querySelector('input[name="code"]') as HTMLInputElement).value = "code123";
  (form.querySelector('input[name="label"]') as HTMLInputElement).value = "办公电脑";
}

/** jsdom's requestSubmit is incomplete; dispatch a cancelable submit event. */
function submitForm(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("bindSetupForm", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = "";
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = "";
  });

  it("calls enroll with apiUrl, code, and deviceLabel on successful enrollment", async () => {
    const root = mountSetupFixture();
    const invoke = vi.fn<InvokeFn>().mockResolvedValue({ ok: true });
    cleanup = bindSetupForm(root, invoke);
    fillValidFields();

    const form = root.getElementById("enroll") as HTMLFormElement;
    submitForm(form);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("enroll", {
        apiUrl: "https://monitor.example.com",
        code: "code123",
        deviceLabel: "办公电脑",
      });
    });

    const status = root.getElementById("status") as HTMLElement;
    expect(status.textContent).toContain("注册成功");
    expect(status.dataset.state).toBe("ok");
    expect(form.hidden).toBe(true);
  });

  it("shows error status when enrollment is rejected", async () => {
    const root = mountSetupFixture();
    const invoke = vi.fn<InvokeFn>().mockRejectedValue(new Error("invalid code"));
    cleanup = bindSetupForm(root, invoke);
    fillValidFields();

    const form = root.getElementById("enroll") as HTMLFormElement;
    submitForm(form);
    await vi.waitFor(() => {
      const status = root.getElementById("status") as HTMLElement;
      expect(status.textContent).toContain("注册失败");
      expect(status.dataset.state).toBe("error");
    });
    expect(form.hidden).toBe(false);
  });

  it("disables submit while enrollment is pending", async () => {
    const root = mountSetupFixture();
    let resolveInvoke!: (value: { ok: boolean }) => void;
    const invoke = vi.fn<InvokeFn>(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    cleanup = bindSetupForm(root, invoke);
    fillValidFields();

    const form = root.getElementById("enroll") as HTMLFormElement;
    const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submitForm(form);

    await vi.waitFor(() => {
      expect(button.disabled).toBe(true);
      const status = root.getElementById("status") as HTMLElement;
      expect(status.dataset.state).toBe("busy");
    });

    resolveInvoke({ ok: true });
    await vi.waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });

  it("requires api_url and code before calling invoke", async () => {
    const root = mountSetupFixture();
    const invoke = vi.fn<InvokeFn>().mockResolvedValue({ ok: true });
    cleanup = bindSetupForm(root, invoke);

    const form = root.getElementById("enroll") as HTMLFormElement;
    submitForm(form);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    expect(form.checkValidity()).toBe(false);

    (form.querySelector('input[name="api_url"]') as HTMLInputElement).value =
      "https://monitor.example.com";
    (form.querySelector('input[name="code"]') as HTMLInputElement).value = "code123";
    expect(form.checkValidity()).toBe(true);

    submitForm(form);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });

  it("cleanup removes the submit listener", async () => {
    const root = mountSetupFixture();
    const invoke = vi.fn<InvokeFn>().mockResolvedValue({ ok: true });
    cleanup = bindSetupForm(root, invoke);
    cleanup();
    cleanup = undefined;
    fillValidFields();

    const form = root.getElementById("enroll") as HTMLFormElement;
    submitForm(form);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
});
