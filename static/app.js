const taskListEl = document.getElementById("task-list");
let currentFilter = "all";
let allTasks = [];

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTasks();
  });
});

function isOverdue(task) {
  if (!task.due_date || task.status === "completed") return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

function filterTasks(tasks) {
  switch (currentFilter) {
    case "pending":
      return tasks.filter((t) => t.status === "pending");
    case "overdue":
      return tasks.filter((t) => isOverdue(t));
    case "completed":
      return tasks.filter((t) => t.status === "completed");
    case "no-date":
      return tasks.filter((t) => !t.due_date);
    default:
      return tasks;
  }
}

function renderTasks() {
  const tasks = filterTasks(allTasks);
  taskListEl.innerHTML = "";
  if (tasks.length === 0) {
    taskListEl.innerHTML = '<li class="task-meta">Bu filtrede görev yok.</li>';
    return;
  }
  tasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-card" + (task.status === "completed" ? " completed" : "") + (isOverdue(task) ? " overdue" : "");

    const main = document.createElement("div");
    main.className = "task-main";

    const title = document.createElement("div");
    title.className = "task-title" + (task.status === "completed" ? " done" : "");
    title.textContent = task.title;
    if (task.origin === "ai_draft") {
      const badge = document.createElement("span");
      badge.className = "ai-badge";
      badge.textContent = "AI önerisi (onaylandı)";
      title.appendChild(badge);
    }
    main.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const dueText = task.due_date
      ? (isOverdue(task) ? `<span class="overdue-label">Geciken: ${task.due_date}</span>` : `Son tarih: ${task.due_date}`)
      : "Tarih bilinmiyor";
    const sourceText = task.source ? ` · Kaynak: ${task.source}` : "";
    meta.innerHTML = dueText + sourceText;
    main.appendChild(meta);

    li.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = task.status === "completed" ? "Geri al" : "Tamamla";
    toggleBtn.addEventListener("click", () => toggleStatus(task));
    actions.appendChild(toggleBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Sil";
    deleteBtn.addEventListener("click", () => deleteTask(task.id));
    actions.appendChild(deleteBtn);

    li.appendChild(actions);
    taskListEl.appendChild(li);
  });
}

async function loadTasks() {
  const res = await fetch("/api/tasks");
  allTasks = await res.json();
  renderTasks();
}

async function toggleStatus(task) {
  const newStatus = task.status === "completed" ? "pending" : "completed";
  await fetch(`/api/tasks/${task.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus }),
  });
  loadTasks();
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  loadTasks();
}

document.getElementById("add-task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  const dueDate = document.getElementById("task-due-date").value || null;
  const source = document.getElementById("task-source").value.trim() || null;
  if (!title) return;

  await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, due_date: dueDate, source, origin: "manual" }),
  });

  e.target.reset();
  document.querySelector('.tab-btn[data-tab="dashboard"]').click();
  loadTasks();
});

document.getElementById("generate-draft-btn").addEventListener("click", async () => {
  const text = document.getElementById("instruction-text").value.trim();
  const errorEl = document.getElementById("draft-error");
  const resultEl = document.getElementById("draft-result");
  errorEl.textContent = "";
  resultEl.innerHTML = "";
  if (!text) return;

  resultEl.innerHTML = '<p class="hint">Oluşturuluyor...</p>';

  const res = await fetch("/api/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  resultEl.innerHTML = "";

  if (!res.ok) {
    errorEl.textContent = draftErrorMessage(data);
    return;
  }

  renderDraft(text, data);
});

function draftErrorMessage(data) {
  if (data.error === "no_api_key") return "AI_API_KEY ayarlanmamış. .env dosyasına anahtarınızı ekleyin.";
  if (data.error === "ai_call_failed") return "AI servisine ulaşılamadı: " + (data.detail || "");
  return "Taslak oluşturulamadı.";
}

function renderDraft(originalText, data) {
  const resultEl = document.getElementById("draft-result");

  const original = document.createElement("div");
  original.className = "draft-original";
  original.textContent = "Orijinal metin: " + originalText;
  resultEl.appendChild(original);

  if (data.clarification_needed) {
    const clarify = document.createElement("div");
    clarify.className = "clarification-box";
    clarify.textContent = "AI netleştirme istiyor: " + data.clarification_needed;
    resultEl.appendChild(clarify);
  }

  if (data.parse_error) {
    const raw = document.createElement("div");
    raw.className = "clarification-box";
    raw.textContent = "AI çıktısı ayrıştırılamadı, ham çıktı: " + (data.raw_output || "");
    resultEl.appendChild(raw);
    return;
  }

  const tasks = data.tasks || [];
  if (tasks.length === 0) {
    const none = document.createElement("p");
    none.className = "hint";
    none.textContent = "AI bu metinden görev önermedi.";
    resultEl.appendChild(none);
    return;
  }

  const itemEls = tasks.map((t) => {
    const item = document.createElement("div");
    item.className = "draft-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;

    const fields = document.createElement("div");
    fields.className = "draft-item-fields";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = t.title || "";

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = t.due_date || "";

    fields.appendChild(titleInput);
    fields.appendChild(dateInput);

    if (t.note) {
      const note = document.createElement("div");
      note.className = "draft-note";
      note.textContent = t.note;
      fields.appendChild(note);
    }

    item.appendChild(checkbox);
    item.appendChild(fields);
    resultEl.appendChild(item);

    return { checkbox, titleInput, dateInput };
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "draft-save-btn";
  saveBtn.textContent = "Onaylananları Kaydet";
  saveBtn.addEventListener("click", async () => {
    const approved = itemEls.filter((el) => el.checkbox.checked && el.titleInput.value.trim());
    for (const el of approved) {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: el.titleInput.value.trim(),
          due_date: el.dateInput.value || null,
          source: "AI taslağı: " + originalText.slice(0, 60),
          origin: "ai_draft",
        }),
      });
    }
    document.getElementById("draft-result").innerHTML = '<p class="hint">Kaydedildi.</p>';
    document.getElementById("instruction-text").value = "";
    document.querySelector('.tab-btn[data-tab="dashboard"]').click();
    loadTasks();
  });
  resultEl.appendChild(saveBtn);
}

loadTasks();
