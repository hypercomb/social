// @diamondcoreprocessor.com/dashboard
// src/diamondcoreprocessor.com/dashboard/qa-modal.view.ts
import { EffectBus } from "@hypercomb/core";
var QaModalView = class extends EventTarget {
  #overlay = null;
  #current = null;
  #onAfterCommit = null;
  show(binding, onAfterCommit) {
    if (this.#overlay) this.close();
    this.#current = binding;
    this.#onAfterCommit = onAfterCommit ?? null;
    const overlay = document.createElement("div");
    overlay.setAttribute("data-hc-qa-modal", "");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "60000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: "0",
      transition: "opacity 180ms ease"
    });
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0, 0, 0, 0.55)",
      cursor: "pointer"
    });
    backdrop.addEventListener("click", () => this.close());
    overlay.appendChild(backdrop);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    Object.assign(dialog.style, {
      position: "relative",
      width: "min(640px, 92vw)",
      maxHeight: "82vh",
      padding: "1.4rem 1.4rem 1.1rem",
      background: "#1c1c20",
      color: "#eaeaea",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "12px",
      boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
      display: "flex",
      flexDirection: "column",
      gap: "0.85rem",
      font: "14px/1.45 Inter, system-ui, sans-serif"
    });
    dialog.addEventListener("click", (e) => e.stopPropagation());
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "close");
    closeBtn.textContent = "\xD7";
    Object.assign(closeBtn.style, {
      position: "absolute",
      top: "0.4rem",
      right: "0.55rem",
      width: "2rem",
      height: "2rem",
      border: "none",
      background: "transparent",
      color: "#eaeaea",
      fontSize: "1.4rem",
      lineHeight: "1",
      cursor: "pointer",
      opacity: "0.7"
    });
    closeBtn.addEventListener("click", () => this.close());
    dialog.appendChild(closeBtn);
    const source = document.createElement("div");
    source.textContent = binding.qPath.length === 0 ? "/" : "/" + binding.qPath.join("/");
    Object.assign(source.style, {
      fontSize: "0.78rem",
      opacity: "0.7",
      letterSpacing: "0.04em"
    });
    dialog.appendChild(source);
    const question = document.createElement("div");
    question.textContent = binding.question;
    Object.assign(question.style, {
      fontSize: "1.02rem",
      lineHeight: "1.5",
      padding: "0.65rem 0.8rem",
      background: "rgba(255, 225, 74, 0.12)",
      border: "1px solid rgba(255, 225, 74, 0.28)",
      borderLeftWidth: "3px",
      borderRadius: "4px 6px 6px 4px",
      whiteSpace: "pre-wrap"
    });
    dialog.appendChild(question);
    const input = document.createElement("textarea");
    input.placeholder = "type your answer\u2026";
    input.rows = 4;
    Object.assign(input.style, {
      width: "100%",
      resize: "vertical",
      padding: "0.55rem 0.7rem",
      background: "rgba(0,0,0,0.22)",
      color: "inherit",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "6px",
      font: "inherit",
      lineHeight: "1.45",
      boxSizing: "border-box"
    });
    dialog.appendChild(input);
    const status = document.createElement("div");
    Object.assign(status.style, {
      minHeight: "1.1em",
      fontSize: "0.78rem",
      opacity: "0.75"
    });
    dialog.appendChild(status);
    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "0.6rem"
    });
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.textContent = "Done";
    Object.assign(doneBtn.style, {
      padding: "0.45rem 1.2rem",
      background: "rgba(110, 180, 255, 0.22)",
      border: "1px solid rgba(110, 180, 255, 0.55)",
      borderRadius: "6px",
      color: "#d4e6ff",
      fontWeight: "600",
      letterSpacing: "0.02em",
      cursor: "pointer"
    });
    actions.appendChild(doneBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    this.#overlay = overlay;
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });
    setTimeout(() => {
      try {
        input.focus();
      } catch {
      }
    }, 60);
    document.addEventListener("keydown", this.#onKeyDown);
    EffectBus.emit("view:active", { active: true, type: "qa-modal" });
    const setStatus = (msg, isErr = false) => {
      status.textContent = msg;
      status.style.color = isErr ? "#ff9b9b" : "";
      status.style.opacity = isErr ? "1" : "0.75";
    };
    doneBtn.addEventListener("click", async () => {
      const text = input.value.trim();
      if (!text) {
        setStatus("type an answer first", true);
        input.focus();
        return;
      }
      const cur = this.#current;
      if (!cur) {
        setStatus("no question loaded", true);
        return;
      }
      doneBtn.disabled = true;
      input.disabled = true;
      setStatus("committing answer\u2026");
      try {
        await this.#commit(cur, text);
        this.#onAfterCommit?.(cur);
        this.close();
      } catch (err) {
        doneBtn.disabled = false;
        input.disabled = false;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("failed: " + msg, true);
      }
    });
  }
  close() {
    if (!this.#overlay) return;
    const overlay = this.#overlay;
    this.#overlay = null;
    this.#current = null;
    this.#onAfterCommit = null;
    overlay.style.opacity = "0";
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 280);
    document.removeEventListener("keydown", this.#onKeyDown);
    EffectBus.emit("view:active", { active: false, type: "qa-modal" });
  }
  get isOpen() {
    return this.#overlay !== null;
  }
  async #commit(binding, text) {
    const store = get("@hypercomb.social/Store");
    if (!store?.putOptimization) throw new Error("Store.putOptimization unavailable");
    const path = binding.qPath;
    if (path.length === 0) throw new Error("missing cell path");
    const answer = {
      kind: "qa-answer",
      appliesTo: path,
      payload: {
        qId: binding.qId,
        qSig: binding.qSig || "",
        question: binding.question,
        answer: text,
        answeredAt: Date.now()
      },
      mark: "persistent"
    };
    const blob = new Blob([new TextEncoder().encode(JSON.stringify(answer))]);
    await store.putOptimization(blob);
    if (binding.qSig) {
      try {
        await store.removeOptimization?.(binding.qSig);
      } catch {
      }
    }
  }
  #onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
};
var _qaModalView = new QaModalView();
window.ioc.register("@diamondcoreprocessor.com/QaModalView", _qaModalView);
export {
  QaModalView
};
