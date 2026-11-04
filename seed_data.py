import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "careloop.db"

now = datetime.now(timezone.utc)

TASKS = [
    ("Kardiyoloji kontrolune randevu al", (now + timedelta(days=10)).date().isoformat(), "Kardiyoloji poliklinigi", "pending", "manual"),
    ("Son kan tahlili sonuclarini getir", None, "Dahiliye", "pending", "manual"),
    ("Fizik tedavi sevk kagidini sevk biriminden al", (now - timedelta(days=3)).date().isoformat(), "Ortopedi", "pending", "manual"),
    ("Recete yenileme", (now - timedelta(days=20)).date().isoformat(), "Aile hekimi", "completed", "manual"),
    ("Diyetisyen ile gorusme ayarla", None, "Dahiliye", "pending", "manual"),
]

SAMPLE_INSTRUCTION = (
    "Hastanin 3 hafta icinde kardiyoloji kontrolune gelmesi gerekiyor. Kontrol "
    "oncesi son kan tahlili sonuclarini ve EKG ciktisini getirmesi lazim. Ayrica "
    "fizik tedavi icin sevk kagidi cikarilacak, bunu hastane sevk biriminden "
    "almalari gerekiyor."
)

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
        created_at TEXT NOT NULL
    )
    """
)
db.execute("DELETE FROM tasks")
for title, due_date, source, status, origin in TASKS:
    db.execute(
        "INSERT INTO tasks (title, due_date, source, status, origin, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (title, due_date, source, status, origin, now.isoformat()),
    )
db.commit()
db.close()

print(f"Seeded {len(TASKS)} synthetic tasks into {DB_PATH}")
print("\nSample instruction text to paste into the AI draft box:\n")
print(SAMPLE_INSTRUCTION)
