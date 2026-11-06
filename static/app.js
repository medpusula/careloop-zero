(function () {
  "use strict";

  var filter = "all";
  var today = new Date().toISOString().slice(0, 10);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = !!window.gsap && !reduceMotion;

  function isOverdue(t) {
    return t.due_date && t.status !== "completed" && t.due_date < today;
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }

  function fetchTasks() {
    fetch("/api/tasks")
      .then(function (r) { return r.json(); })
      .then(renderTasks)
      .catch(function () {
        document.getElementById("task-list").innerHTML =
          '<li class="empty">Could not load tasks. Is the server running?</li>';
      });
  }

  function renderTasks(tasks) {
    var list = document.getElementById("task-list");
    var shown = tasks.filter(function (t) {
      if (filter === "pending") return t.status === "pending";
      if (filter === "overdue") return isOverdue(t);
      if (filter === "completed") return t.status === "completed";
      if (filter === "no-date") return !t.due_date;
      return true;
    });
    list.innerHTML = "";
    if (shown.length === 0) {
      list.innerHTML = '<li class="empty">No tasks in this filter.</li>';
      return;
    }
    shown.forEach(function (t) {
      var li = document.createElement("li");
      li.className =
        "task" + (t.status === "completed" ? " done" : "") + (isOverdue(t) ? " overdue" : "");
      var meta = t.due_date
        ? isOverdue(t)
          ? "<b>Overdue: " + t.due_date + "</b>"
          : "Due: " + t.due_date
        : "No date";
      if (t.source) meta += " · Source: " + escapeHtml(t.source);
      var badge = t.origin === "ai" ? '<span class="badge">AI suggestion</span>' : "";
      li.innerHTML =
        '<div class="t-body"><div class="t-title">' + escapeHtml(t.title) + badge + "</div>" +
        '<div class="t-meta">' + meta + "</div></div>" +
        '<div class="t-actions">' +
        '<button data-act="toggle" data-id="' + t.id + '">' +
        (t.status === "completed" ? "Undo" : "Complete") +
        "</button>" +
        '<button data-act="del" data-id="' + t.id + '">Delete</button></div>';
      list.appendChild(li);
    });
    if (hasGsap && list.children.length) {
      gsap.from(list.children, { opacity: 0, y: 10, duration: 0.35, stagger: 0.05, ease: "power2.out" });
    }
  }

  document.getElementById("task-list").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.dataset.id;
    var li = btn.closest(".task");

    if (btn.dataset.act === "toggle") {
      var completed = li.classList.contains("done");
      var apply = function () {
        fetch("/api/tasks/" + id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: completed ? "pending" : "completed" }),
        }).then(fetchTasks);
      };
      if (hasGsap) {
        gsap.to(li, { scale: 0.98, duration: 0.08, yoyo: true, repeat: 1, onComplete: apply });
      } else {
        apply();
      }
    } else if (btn.dataset.act === "del") {
      var doDelete = function () {
        fetch("/api/tasks/" + id, { method: "DELETE" }).then(fetchTasks);
      };
      if (hasGsap) {
        gsap.to(li, {
          opacity: 0, x: 24, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0,
          duration: 0.3, ease: "power1.in", onStart: function () { li.style.overflow = "hidden"; },
          onComplete: doDelete,
        });
      } else {
        doDelete();
      }
    }
  });

  document.querySelectorAll(".filter-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-btn").forEach(function (b) {
        b.setAttribute("aria-pressed", "false");
      });
      btn.setAttribute("aria-pressed", "true");
      filter = btn.dataset.filter;
      fetchTasks();
    });
  });

  function switchTab(tabId) {
    var current = document.querySelector(".panel.active");
    var next = document.getElementById(tabId);
    if (!next || current === next) return;
    var activate = function () {
      if (current) current.classList.remove("active");
      next.classList.add("active");
      if (hasGsap) gsap.fromTo(next, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" });
      if (tabId === "dashboard") fetchTasks();
    };
    if (hasGsap && current) {
      gsap.to(current, { opacity: 0, y: -6, duration: 0.15, ease: "power1.in", onComplete: activate });
    } else {
      activate();
    }
  }

  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.setAttribute("aria-pressed", "false");
      });
      btn.setAttribute("aria-pressed", "true");
      switchTab(btn.dataset.tab);
    });
  });

  document.getElementById("add-task-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = document.getElementById("task-title").value.trim();
    if (!title) return;
    var due = document.getElementById("task-due-date").value || null;
    var source = document.getElementById("task-source").value.trim() || null;
    fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, due_date: due, source: source, origin: "manual" }),
    }).then(function () {
      e.target.reset();
      document.querySelector('.tab-btn[data-tab="dashboard"]').click();
    });
  });

  document.getElementById("ai-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = document.getElementById("instruction-text").value.trim();
    var errBox = document.getElementById("draft-error");
    var resultBox = document.getElementById("draft-result");
    var submitBtn = document.getElementById("generate-draft-btn");
    errBox.textContent = "";
    resultBox.innerHTML = "";
    if (!text) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Generating...";
    var pulse = hasGsap
      ? gsap.to(submitBtn, { opacity: 0.6, duration: 0.6, repeat: -1, yoyo: true, ease: "sine.inOut" })
      : null;

    fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (pulse) pulse.kill();
        gsap && gsap.set(submitBtn, { opacity: 1 });
        submitBtn.disabled = false;
        submitBtn.textContent = "Generate Draft";
        if (!res.ok || res.data.error) {
          var msg = {
            no_api_key: "AI is not configured on this server.",
            rate_limited: res.data.detail || "Daily AI limit reached for this session. Try again tomorrow.",
            ai_call_failed: "The AI call failed. Try again in a moment.",
            empty_text: "Enter some instruction text first.",
          }[res.data.error] || "Something went wrong.";
          errBox.textContent = msg;
          return;
        }
        renderDraft(text, res.data);
      })
      .catch(function () {
        if (pulse) pulse.kill();
        gsap && gsap.set(submitBtn, { opacity: 1 });
        submitBtn.disabled = false;
        submitBtn.textContent = "Generate Draft";
        errBox.textContent = "Could not reach the server.";
      });
  });

  function renderDraft(originalText, data) {
    var box = document.getElementById("draft-result");
    box.innerHTML = "";

    var original = document.createElement("div");
    original.className = "ai-original";
    original.textContent = "Original text: " + originalText;
    box.appendChild(original);

    if (data.clarification_needed) {
      var clar = document.createElement("div");
      clar.className = "ai-note";
      clar.textContent = "Needs clarification: " + data.clarification_needed;
      box.appendChild(clar);
    }

    if (data.parse_error) {
      var perr = document.createElement("div");
      perr.className = "ai-note";
      perr.textContent = "The AI response could not be parsed as structured tasks. Raw output is shown below.";
      box.appendChild(perr);
      var raw = document.createElement("div");
      raw.className = "ai-original";
      raw.textContent = data.raw_output || "";
      box.appendChild(raw);
      return;
    }

    var tasks = data.tasks || [];
    if (tasks.length === 0) {
      var none = document.createElement("div");
      none.className = "ai-note";
      none.textContent = "No concrete tasks were extracted from this text.";
      box.appendChild(none);
      return;
    }

    var items = [];
    tasks.forEach(function (item) {
      var el = document.createElement("div");
      el.className = "ai-item";
      var metaBits = [];
      metaBits.push(item.due_date ? "Due: " + item.due_date : "No date (none invented)");
      if (item.note) metaBits.push(item.note);
      el.innerHTML =
        '<div class="t-body"><span class="t-title">' + escapeHtml(item.title) + "</span>" +
        '<div class="t-meta">' + escapeHtml(metaBits.join(" · ")) + "</div></div>" +
        "<button>Accept</button>";
      el.querySelector("button").addEventListener("click", function (ev) {
        var acceptBtn = ev.target;
        acceptBtn.disabled = true;
        acceptBtn.textContent = "Adding...";
        fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.title,
            due_date: item.due_date || null,
            source: "AI draft",
            origin: "ai",
          }),
        }).then(function () {
          acceptBtn.textContent = "Added ✓";
          if (hasGsap) gsap.fromTo(acceptBtn, { scale: 1.15 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
        });
      });
      box.appendChild(el);
      items.push(el);
    });
    if (hasGsap && items.length) {
      gsap.from(items, { opacity: 0, y: 10, duration: 0.35, stagger: 0.08, ease: "power2.out" });
    }
  }

  if (hasGsap) {
    gsap.from(".reveal", { opacity: 0, y: 14, duration: 0.5, stagger: 0.07, ease: "power2.out" });
  }

  fetchTasks();
})();
