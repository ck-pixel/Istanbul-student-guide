// "Rate a guide" form: 1–5 stars, optional comment, Cloudflare Turnstile spam check.
// Sends only topic, rating, comment, the honeypot field, and the Turnstile token.
// It cannot read stored feedback: the server has no endpoint for that.
(() => {
  const form = document.querySelector("#rating-form");
  if (!form) return;

  const TOPICS = new Set([...form.querySelectorAll("#rating-topic option")].map((o) => o.value).filter(Boolean));
  const MAX_COMMENT = 1000;
  const el = {
    topic: form.querySelector("#rating-topic"),
    stars: [...form.querySelectorAll('input[name="rating"]')],
    starValue: form.querySelector("#rating-stars-value"),
    comment: form.querySelector("#rating-comment"),
    count: form.querySelector("#rating-comment-count"),
    website: form.querySelector("#rating-website"),
    turnstileBox: form.querySelector("#turnstile-widget"),
    turnstileStatus: form.querySelector("#turnstile-status"),
    status: form.querySelector("#rating-status"),
    submit: form.querySelector("#rating-submit"),
    again: form.querySelector("#rating-again"),
    errors: {
      topic: form.querySelector("#rating-topic-error"),
      rating: form.querySelector("#rating-stars-error"),
      comment: form.querySelector("#rating-comment-error"),
    },
  };

  let token = null;
  let widgetId = null;
  let inFlight = false;
  let submitted = false;

  const chars = (text) => [...text].length;
  const selectedRating = () => {
    const checked = el.stars.find((s) => s.checked);
    return checked ? Number(checked.value) : null;
  };
  const showStatus = (kind, text) => {
    el.status.hidden = false;
    el.status.className = `form-status ${kind}`;
    el.status.textContent = text;
  };
  const setError = (name, message) => {
    const target = el.errors[name];
    target.textContent = message || "";
    target.hidden = !message;
    const control = name === "topic" ? el.topic : name === "comment" ? el.comment : null;
    if (control) control.setAttribute("aria-invalid", message ? "true" : "false");
  };
  const updateSubmit = () => {
    el.submit.disabled = inFlight || submitted || !token;
  };

  // Prefill the topic from ?topic=, e.g. links from a guide page.
  const wanted = new URLSearchParams(location.search).get("topic");
  if (wanted && TOPICS.has(wanted)) el.topic.value = wanted;

  el.stars.forEach((star) => star.addEventListener("change", () => {
    const value = selectedRating();
    el.starValue.textContent = `${value} out of 5 stars selected`;
    setError("rating", "");
  }));
  el.topic.addEventListener("change", () => setError("topic", ""));
  const updateCount = () => {
    const n = chars(el.comment.value);
    el.count.textContent = `${n.toLocaleString("en")} / 1,000`;
    el.count.classList.toggle("over", n > MAX_COMMENT);
  };
  el.comment.addEventListener("input", () => { updateCount(); setError("comment", ""); });

  // Mirrors the server's checks so students get instant, specific feedback.
  const validate = () => {
    let ok = true;
    if (!TOPICS.has(el.topic.value)) { setError("topic", "Please choose a guide."); ok = false; }
    const rating = selectedRating();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) { setError("rating", "Please choose a rating from 1 to 5 stars."); ok = false; }
    const comment = el.comment.value.trim();
    if (chars(comment) > MAX_COMMENT) {
      setError("comment", "Comments can be up to 1,000 characters."); ok = false;
    } else if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(comment) || /(?:\+?\d[\s.()-]?){10,}/.test(comment)) {
      setError("comment", "Please remove email addresses and phone numbers from your comment."); ok = false;
    }
    if (!ok) {
      showStatus("err", "Please fix the highlighted fields.");
      const firstError = Object.entries(el.errors).find(([, node]) => !node.hidden);
      if (firstError) (firstError[0] === "rating" ? el.stars[0] : firstError[0] === "topic" ? el.topic : el.comment).focus();
    }
    return ok;
  };

  // ---------- Turnstile ----------
  const resetTurnstile = () => {
    token = null;
    if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
    updateSubmit();
  };
  const renderTurnstile = (siteKey) => {
    widgetId = window.turnstile.render(el.turnstileBox, {
      sitekey: siteKey,
      action: "student-feedback",
      size: "flexible",
      callback: (value) => { token = value; el.turnstileStatus.textContent = "Spam check complete."; updateSubmit(); },
      "expired-callback": () => { token = null; el.turnstileStatus.textContent = "The spam check expired. It will refresh automatically."; updateSubmit(); },
      "error-callback": () => { token = null; el.turnstileStatus.textContent = "The spam check could not load. Please refresh the page and try again."; updateSubmit(); },
    });
    el.turnstileStatus.textContent = "Complete the spam check to enable sending.";
  };
  fetch("/api/student-feedback/config", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error("config"))))
    .then(({ siteKey }) => {
      if (!siteKey) throw new Error("config");
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => renderTurnstile(siteKey);
      script.onerror = () => { el.turnstileStatus.textContent = "The spam check could not load. Please try again later."; };
      document.head.append(script);
    })
    .catch(() => {
      el.turnstileStatus.textContent = "Rating is temporarily unavailable. Please try again later.";
    });

  // ---------- Submit ----------
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (inFlight || submitted) return; // prevents double clicks and repeated submissions
    if (!validate()) return;
    if (!token) { showStatus("err", "Please complete the spam check first."); return; }

    inFlight = true;
    updateSubmit();
    form.setAttribute("aria-busy", "true");
    el.submit.firstChild.textContent = "Sending… ";
    showStatus("", "Sending your rating…");

    const comment = el.comment.value.trim();
    try {
      const response = await fetch("/api/student-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          topic: el.topic.value,
          rating: selectedRating(),
          comment: comment || null,
          website: el.website.value,
          turnstileToken: token,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Sorry, your rating could not be sent. Please try again later.");
      submitted = true;
      [el.topic, el.comment, ...el.stars].forEach((control) => { control.disabled = true; });
      el.again.hidden = false;
      showStatus("ok", "Thank you! Your rating was received. It is private and only used to improve the guides.");
    } catch (error) {
      showStatus("err", error.message);
      resetTurnstile(); // Turnstile tokens are single-use
    } finally {
      inFlight = false;
      form.removeAttribute("aria-busy");
      el.submit.firstChild.textContent = "Send rating ";
      updateSubmit();
      el.status.focus();
    }
  });

  el.again.addEventListener("click", () => {
    submitted = false;
    form.reset();
    [el.topic, el.comment, ...el.stars].forEach((control) => { control.disabled = false; });
    el.starValue.textContent = "No rating selected";
    el.again.hidden = true;
    el.status.hidden = true;
    updateCount();
    resetTurnstile();
    el.topic.focus();
  });

  updateCount();
})();
