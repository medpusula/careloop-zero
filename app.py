import json
import os
import sqlite3
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template, request, session

load_dotenv()

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "careloop.db"

AI_PROVIDER = os.environ.get("AI_PROVIDER", "anthropic")
AI_API_KEY = os.environ.get("AI_API_KEY", "")

# Each visitor gets their own isolated task list via a signed session cookie —
# without this, every visitor to a public deployment would share one task list.
MAX_AI_CALLS_PER_SESSION_PER_DAY = 20
_ai_call_log = defaultdict(list)  # session_id -> [unix timestamps]; resets on restart, fine for a prototype

SEED_TASKS = [
    ("Book cardiology follow-up appointment", 10, "Cardiology clinic", "pending"),
    ("Bring latest blood test results", None, "Internal medicine", "pending"),
    ("Pick up physical therapy referral from referrals office", -3, "Orthopedics", "pending"),
    ("Renew prescription", -20, "Family doctor", "completed"),
    ("Schedule dietitian consultation", None, "Internal medicine", "pending"),
]

SYSTEM_PROMPT = (
    "You help turn a short, non-identifying, clinician-provided instruction into a list "
    "of administrative/organizational caregiver tasks (e.g. book an appointment, bring a "
    "document, arrange a referral visit). Extract ONLY what is explicitly stated in the "
    "text. Never invent a due date, medication, dose, diagnosis, or treatment detail that "
    "is not in the text. If the text is ambiguous or you are not confident, say so in "
    "clarification_needed instead of guessing. "
    "Respond with ONLY valid JSON, no other text, matching this schema: "
    '{"tasks": [{"title": string, "due_date": string or null, "note": string or null}], '
    '"clarification_needed": string or null}'
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")
app.config.update(SESSION_COOKIE_SAMESITE="Lax", PERMANENT_SESSION_LIFETIME=timedelta(days=90))


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def get_session_id():
    session.permanent = True
    if "sid" not in session:
        session["sid"] = uuid.uuid4().hex
    return session["sid"]


def seed_tasks_for_session(db, session_id):
    now = datetime.now(timezone.utc)
    for title, day_offset, source, status in SEED_TASKS:
        due_date = (now + timedelta(days=day_offset)).date().isoformat() if day_offset is not None else None
        db.execute(
            "INSERT INTO tasks (title, due_date, source, status, origin, created_at, session_id) "
            "VALUES (?, ?, ?, ?, 'manual', ?, ?)",
            (title, due_date, source, status, now.isoformat(), session_id),
        )
    db.commit()


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            due_date TEXT,
            source TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            origin TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL,
            session_id TEXT
        )
        """
    )
    try:
        db.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT")
    except sqlite3.OperationalError:
        pass  # already has the column (fresh table, or already migrated)
    db.commit()
    db.close()


init_db()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    sid = get_session_id()
    db = get_db()
    count = db.execute("SELECT COUNT(*) FROM tasks WHERE session_id = ?", (sid,)).fetchone()[0]
    if count == 0:
        seed_tasks_for_session(db, sid)
    rows = db.execute(
        "SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC", (sid,)
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.route("/api/tasks", methods=["POST"])
def create_task():
    sid = get_session_id()
    data = request.get_json()
    db = get_db()
    cur = db.execute(
        "INSERT INTO tasks (title, due_date, source, status, origin, created_at, session_id) "
        "VALUES (?, ?, ?, 'pending', ?, ?, ?)",
        (
            data["title"],
            data.get("due_date"),
            data.get("source"),
            data.get("origin", "manual"),
            datetime.now(timezone.utc).isoformat(),
            sid,
        ),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    sid = get_session_id()
    data = request.get_json()
    db = get_db()
    fields, values = [], []
    for key in ("title", "due_date", "source", "status"):
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if fields:
        values.append(task_id)
        values.append(sid)
        db.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ? AND session_id = ?", values)
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    sid = get_session_id()
    db = get_db()
    db.execute("DELETE FROM tasks WHERE id = ? AND session_id = ?", (task_id, sid))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/draft", methods=["POST"])
def draft_tasks():
    sid = get_session_id()
    instruction_text = (request.get_json() or {}).get("text", "").strip()
    if not instruction_text:
        return jsonify({"error": "empty_text"}), 400
    if not AI_API_KEY:
        return jsonify({"error": "no_api_key"}), 500

    cutoff = time.time() - 86400
    recent_calls = [t for t in _ai_call_log[sid] if t > cutoff]
    if len(recent_calls) >= MAX_AI_CALLS_PER_SESSION_PER_DAY:
        return jsonify({"error": "rate_limited", "detail": "Daily AI draft limit reached for this session. Try again tomorrow."}), 429
    recent_calls.append(time.time())
    _ai_call_log[sid] = recent_calls

    try:
        result = call_ai(instruction_text)
    except requests.RequestException as exc:
        return jsonify({"error": "ai_call_failed", "detail": str(exc)}), 502

    return jsonify(result)


def call_ai(instruction_text):
    if AI_PROVIDER in ("openai", "groq"):
        base_url = (
            "https://api.groq.com/openai/v1/chat/completions"
            if AI_PROVIDER == "groq"
            else "https://api.openai.com/v1/chat/completions"
        )
        model = "openai/gpt-oss-120b" if AI_PROVIDER == "groq" else "gpt-4o-mini"
        response = requests.post(
            base_url,
            headers={"Authorization": f"Bearer {AI_API_KEY}"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": instruction_text},
                ],
                "response_format": {"type": "json_object"},
            },
            timeout=30,
        )
        response.raise_for_status()
        raw_text = response.json()["choices"][0]["message"]["content"]
    else:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": AI_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-5-5",
                "max_tokens": 1024,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": instruction_text}],
            },
            timeout=30,
        )
        response.raise_for_status()
        raw_text = response.json()["content"][0]["text"]

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        return {
            "tasks": [],
            "clarification_needed": None,
            "raw_output": raw_text,
            "parse_error": True,
        }


if __name__ == "__main__":
    app.run(debug=True, port=5000)
