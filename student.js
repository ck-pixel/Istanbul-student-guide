// Student Life features: guide search + category filter, "Was this helpful?",
// saved checklists, and the correction/topic form. Everything degrades
// gracefully: without JavaScript all guides stay listed and the form still posts.
(() => {
  const root = document.documentElement.dataset.root || "";

  const safeStorage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  };

  // ---------- Search and category navigation (hub page) ----------
  const grid = document.querySelector("[data-guide-grid]");
  if (grid) {
    const cards = [...grid.querySelectorAll(".guide-card")];
    const input = document.querySelector("#guide-search");
    const chips = [...document.querySelectorAll(".category-nav .chip")];
    const count = document.querySelector("#result-count");
    const empty = document.querySelector("#no-results");
    const form = document.querySelector("#guide-search-form");
    const index = {};
    let category = "all";

    const normalize = (text) => text.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");

    const apply = () => {
      const terms = normalize(input.value.trim()).split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const card of cards) {
        const href = card.getAttribute("href");
        const haystack = normalize(card.textContent + " " + (index[href] || ""));
        const inCategory = category === "all" || card.dataset.category === category;
        const matches = terms.every((term) => haystack.includes(term));
        card.hidden = !(inCategory && matches);
        if (!card.hidden) shown++;
      }
      count.textContent = `${shown} ${shown === 1 ? "guide" : "guides"} shown`;
      empty.hidden = shown !== 0;
      const params = new URLSearchParams(location.search);
      if (input.value) params.set("q", input.value); else params.delete("q");
      if (category !== "all") params.set("category", category); else params.delete("category");
      const query = params.toString();
      history.replaceState(null, "", query ? `?${query}` : location.pathname);
    };

    const setCategory = (value) => {
      category = chips.some((chip) => chip.dataset.category === value) ? value : "all";
      for (const chip of chips) chip.setAttribute("aria-pressed", String(chip.dataset.category === category));
    };

    const params = new URLSearchParams(location.search);
    input.value = params.get("q") || "";
    setCategory(params.get("category") || "all");

    chips.forEach((chip) => chip.addEventListener("click", () => { setCategory(chip.dataset.category); apply(); }));
    input.addEventListener("input", apply);
    form.addEventListener("submit", (event) => { event.preventDefault(); apply(); });

    fetch(`${root}search-index.json`)
      .then((response) => (response.ok ? response.json() : []))
      .then((entries) => {
        for (const entry of entries) index[entry.href] = `${entry.headings} ${entry.keywords}`;
        apply();
      })
      .catch(apply);
    apply();
  }

  // ---------- "Was this helpful?" ----------
  for (const box of document.querySelectorAll("[data-feedback]")) {
    const page = box.dataset.feedback;
    const status = box.querySelector(".feedback-status");
    const buttons = [...box.querySelectorAll("button[data-helpful]")];
    const doneKey = `feedback:${page}`;
    const suggestLink = `${root}suggest.html?page=${encodeURIComponent(page)}`;
    const thanks = (helpful) => {
      buttons.forEach((button) => { button.disabled = true; button.setAttribute("aria-pressed", String(button.dataset.helpful === helpful)); });
      status.innerHTML = helpful === "yes"
        ? "Thanks for letting us know."
        : `Thanks. <a href="${suggestLink}">Tell us what was missing or wrong</a>.`;
    };
    const saved = safeStorage.get(doneKey);
    if (saved) { thanks(saved); continue; }
    buttons.forEach((button) => button.addEventListener("click", async () => {
      const helpful = button.dataset.helpful;
      buttons.forEach((b) => { b.disabled = true; });
      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, helpful: helpful === "yes" }),
        });
        if (!response.ok) throw new Error(String(response.status));
        safeStorage.set(doneKey, helpful);
        thanks(helpful);
      } catch {
        buttons.forEach((b) => { b.disabled = false; });
        status.innerHTML = `Sorry, your answer could not be saved right now. You can still <a href="${suggestLink}">send a suggestion</a>.`;
      }
    }));
  }

  // ---------- Checklists remember ticks on this device ----------
  for (const list of document.querySelectorAll("[data-checklist]")) {
    const name = list.dataset.checklist;
    const key = `checklist:${name}`;
    const boxes = [...list.querySelectorAll("input[type=checkbox]")];
    const progress = document.querySelector(`[data-progress-for="${name}"]`);
    let saved = [];
    try { saved = JSON.parse(safeStorage.get(key) || "[]"); } catch { saved = []; }
    boxes.forEach((box, i) => { box.checked = saved.includes(i); });
    const update = () => {
      const done = boxes.flatMap((box, i) => (box.checked ? [i] : []));
      safeStorage.set(key, JSON.stringify(done));
      if (progress) progress.textContent = `${done.length} of ${boxes.length} done (saved on this device only)`;
    };
    boxes.forEach((box) => box.addEventListener("change", update));
    update();
  }

  // ---------- Correction / new topic form ----------
  const suggestForm = document.querySelector("#suggest-form");
  if (suggestForm) {
    const status = document.querySelector("#form-status");
    const params = new URLSearchParams(location.search);
    const pageSelect = suggestForm.querySelector("#suggest-page");
    const wanted = params.get("page");
    if (wanted && [...pageSelect.options].some((o) => o.value === wanted)) pageSelect.value = wanted;
    const show = (kind, text) => { status.hidden = false; status.className = `form-status ${kind}`; status.textContent = text; };
    if (params.get("sent") === "1") show("ok", "Thank you. Your message was received and will be reviewed before any change is made.");
    if (params.get("sent") === "0") show("err", "Sorry, your message could not be sent. Please check the form and try again later.");
    suggestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!suggestForm.reportValidity()) return;
      const button = suggestForm.querySelector("button[type=submit]");
      button.disabled = true;
      show("", "Sending…");
      try {
        const response = await fetch(suggestForm.action, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(suggestForm),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Sorry, your message could not be sent.");
        suggestForm.reset();
        show("ok", "Thank you. Your message was received and will be reviewed before any change is made.");
      } catch (error) {
        show("err", `${error.message} Please try again later.`);
      } finally {
        button.disabled = false;
        status.focus();
      }
    });
  }
})();
