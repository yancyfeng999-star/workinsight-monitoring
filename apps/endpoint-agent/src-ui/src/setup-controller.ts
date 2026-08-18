export type EnrollArgs = {
  apiUrl: string;
  code: string;
  deviceLabel: string;
};

export type InvokeFn = (
  command: "enroll",
  args: EnrollArgs,
) => Promise<unknown>;

type EnrollResult = {
  ok: boolean;
  error?: string;
};

function isEnrollResult(value: unknown): value is EnrollResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as EnrollResult).ok === "boolean"
  );
}

export function bindSetupForm(root: Document, invoke: InvokeFn): () => void {
  const form = root.getElementById("enroll") as HTMLFormElement | null;
  const status = root.getElementById("status");
  if (!form || !status) {
    return () => {};
  }

  const button = form.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement | null;

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData(form);
    status.textContent = "注册中…";
    status.dataset.state = "busy";
    if (button) {
      button.disabled = true;
    }

    try {
      const result = await invoke("enroll", {
        apiUrl: String(data.get("api_url") ?? ""),
        code: String(data.get("code") ?? ""),
        deviceLabel: String(data.get("label") ?? ""),
      });

      if (isEnrollResult(result) && result.ok) {
        form.hidden = true;
        status.textContent = "注册成功，Agent 已在后台运行。";
        status.dataset.state = "ok";
      } else {
        const message = isEnrollResult(result)
          ? (result.error ?? "未知错误")
          : "未知错误";
        status.textContent = `注册失败：${message}`;
        status.dataset.state = "error";
      }
    } catch (err) {
      status.textContent = `注册失败：${String(err)}`;
      status.dataset.state = "error";
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  };

  form.addEventListener("submit", onSubmit);
  return () => {
    form.removeEventListener("submit", onSubmit);
  };
}
