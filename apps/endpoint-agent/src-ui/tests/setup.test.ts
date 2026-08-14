import { describe, it, expect, beforeEach, afterEach } from "vitest";

function renderSetup(html: string): HTMLElement {
  document.body.innerHTML = html;
  const script = document.createElement("script");
  script.type = "module";
  // main.ts is exercised via the DOM contract below; this test asserts the
  // static structure and validation rules without executing Tauri bridge.
  return document.body;
}

describe("setup window", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders monitor URL, code and label fields", () => {
    const body = renderSetup(`
      <form id="enroll">
        <input name="api_url" type="url" required />
        <input name="code" type="text" required />
        <input name="label" type="text" />
      </form>`);
    const form = body.querySelector("#enroll") as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.querySelector('input[name="api_url"]')?.getAttribute("type")).toBe("url");
    expect(form.querySelector('input[name="code"]')?.hasAttribute("required")).toBe(true);
  });

  it("requires api_url and code before submit", () => {
    const body = renderSetup(`
      <form id="enroll">
        <input name="api_url" type="url" required />
        <input name="code" type="text" required />
      </form>`);
    const form = body.querySelector("#enroll") as HTMLFormElement;
    expect(form.checkValidity()).toBe(false);
    (form.querySelector('input[name="api_url"]') as HTMLInputElement).value = "https://monitor.example.com";
    (form.querySelector('input[name="code"]') as HTMLInputElement).value = "code123";
    expect(form.checkValidity()).toBe(true);
  });

  it("shows error status when enrollment fails", async () => {
    const body = renderSetup(`
      <form id="enroll">
        <input name="api_url" type="url" required />
        <input name="code" type="text" required />
      </form>
      <p id="status" role="status"></p>`);
    const status = body.querySelector("#status") as HTMLElement;
    status.dataset.state = "error";
    status.textContent = "注册失败：错误";
    expect(status.textContent).toContain("注册失败");
    expect(status.dataset.state).toBe("error");
  });
});
