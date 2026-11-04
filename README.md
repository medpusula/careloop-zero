# CareLoop Zero — Prototype

A task tracker that extracts follow-up tasks from clinician instructions, for
family caregivers. Built with synthetic data only; do not enter real
patient/identifying information.

- **Live demo (static, no backend):** https://ughurpirali.github.io/careloop-zero/
- **Live app (real backend + AI):** see Deployment below

## Local setup (Windows PowerShell)

```
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Open `.env` and fill in:
- `AI_API_KEY` — your key. Set `AI_PROVIDER` to `anthropic`, `openai`, or `groq`
  to match where the key is from (tested working with Groq, model
  `openai/gpt-oss-120b`).
- `SECRET_KEY` — any random string, used to sign the session cookie that
  keeps each visitor's task list private. A dev default is used if left
  blank, but set a real one before deploying publicly.

`.env` is in `.gitignore` and never committed.

## Running locally

```
python app.py
```

Open http://127.0.0.1:5000 — each browser session gets its own private,
auto-seeded task list (no login needed).

## Deployment (Render, free tier)

1. Push this repo to GitHub (already done: https://github.com/ughurpirali/careloop-zero).
2. Create a free account at [render.com](https://render.com) and connect your GitHub account.
3. **New +** → **Web Service** → select this repo.
4. Build command: `pip install -r requirements.txt`. Start command is read
   from the `Procfile` (`gunicorn app:app`).
5. Add environment variables: `AI_PROVIDER`, `AI_API_KEY`, `SECRET_KEY`
   (generate a new random one, don't reuse the local dev one).
6. Deploy. Render's free tier sleeps after inactivity and its disk is
   ephemeral — the database resets on redeploy/restart, which is fine for a
   prototype since each visitor is auto-seeded with fresh sample tasks.

## Known limitations (MVP stage)

- No accounts — each visitor is identified only by an anonymous session
  cookie, not a real login. Clearing cookies starts a fresh task list.
- The AI draft endpoint is rate-limited per session (20 calls/day) to
  protect the shared API key from abuse on a public deployment.
- If the AI response isn't valid JSON, the raw output is shown instead of
  retrying automatically.
- Re-running the AI draft on the same instruction can re-suggest the same
  tasks, creating duplicates if accepted twice — the user must catch this at
  the accept step.
- No tracking yet for access barriers (transport, finding the right contact,
  etc.) — won't be added without real caregiver research confirming it's needed.
