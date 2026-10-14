
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ==========================================
# Voice Notes - Local SQLite Backend
# ==========================================

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "voice_notes.db"


# ---------- Database connection ----------

def get_connection():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def current_time():
    return datetime.now(timezone.utc).isoformat()


def initialize_database():
    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT 'Untitled note',
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                pinned INTEGER NOT NULL DEFAULT 0
            )
        """)

        # Add missing columns if the database already exists.
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(notes)").fetchall()
        }

        if "title" not in columns:
            connection.execute(
                "ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT 'Untitled note'"
            )

        if "content" not in columns:
            connection.execute(
                "ALTER TABLE notes ADD COLUMN content TEXT NOT NULL DEFAULT ''"
            )

        if "created_at" not in columns:
            connection.execute("ALTER TABLE notes ADD COLUMN created_at TEXT")

        if "updated_at" not in columns:
            connection.execute("ALTER TABLE notes ADD COLUMN updated_at TEXT")

        if "pinned" not in columns:
            connection.execute(
                "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"
            )

        connection.execute("""
            UPDATE notes
            SET created_at = ?
            WHERE created_at IS NULL OR created_at = ''
        """, (current_time(),))


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


# ---------- FastAPI application ----------

app = FastAPI(
    title="Voice Notes API",
    description="A local API for saving and managing voice notes.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"]
)


# ---------- Request models ----------

class NoteCreate(BaseModel):
    title: str = Field(default="Untitled note", max_length=150)
    content: str = Field(min_length=1)


class NoteUpdate(BaseModel):
    title: str = Field(default="Untitled note", max_length=150)
    content: str = Field(min_length=1)


class PinUpdate(BaseModel):
    pinned: bool


# ---------- Helper functions ----------

def get_note_or_404(connection, note_id):
    note = connection.execute(
        "SELECT * FROM notes WHERE id = ?",
        (note_id,)
    ).fetchone()

    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    return note


def serialize_note(row):
    note = dict(row)
    note["pinned"] = bool(note["pinned"])
    return note


# ---------- Health check ----------

@app.get("/health")
def health_check():
    try:
        with get_connection() as connection:
            connection.execute("SELECT 1")

        return {
            "status": "ok",
            "message": "Voice Notes backend is running",
            "database": "connected"
        }

    except sqlite3.Error as error:
        raise HTTPException(
            status_code=500,
            detail=f"Database error: {error}"
        )


# ---------- Get all notes ----------

@app.get("/notes")
def get_notes():
    try:
        with get_connection() as connection:
            rows = connection.execute("""
                SELECT *
                FROM notes
                ORDER BY pinned DESC, datetime(created_at) DESC, id DESC
            """).fetchall()

        return [serialize_note(row) for row in rows]

    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=str(error))


# ---------- Create a note ----------

@app.post("/notes", status_code=201)
def create_note(note_data: NoteCreate):
    title = note_data.title.strip() or "Untitled note"
    content = note_data.content.strip()

    if not content:
        raise HTTPException(
            status_code=422,
            detail="Note content cannot be empty"
        )

    timestamp = current_time()

    try:
        with get_connection() as connection:
            cursor = connection.execute("""
                INSERT INTO notes (
                    title, content, created_at, updated_at, pinned
                )
                VALUES (?, ?, ?, ?, 0)
            """, (title, content, timestamp, timestamp))

            note_id = cursor.lastrowid

            row = connection.execute(
                "SELECT * FROM notes WHERE id = ?",
                (note_id,)
            ).fetchone()

        return serialize_note(row)

    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=str(error))


# ---------- Update a note ----------

@app.put("/notes/{note_id}")
def update_note(note_id: int, note_data: NoteUpdate):
    title = note_data.title.strip() or "Untitled note"
    content = note_data.content.strip()

    if not content:
        raise HTTPException(
            status_code=422,
            detail="Note content cannot be empty"
        )

    try:
        with get_connection() as connection:
            get_note_or_404(connection, note_id)

            connection.execute("""
                UPDATE notes
                SET title = ?, content = ?, updated_at = ?
                WHERE id = ?
            """, (title, content, current_time(), note_id))

            row = connection.execute(
                "SELECT * FROM notes WHERE id = ?",
                (note_id,)
            ).fetchone()

        return serialize_note(row)

    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=str(error))


# ---------- Pin or unpin a note ----------

@app.patch("/notes/{note_id}/pin")
def toggle_pin(note_id: int, pin_data: PinUpdate):
    try:
        with get_connection() as connection:
            get_note_or_404(connection, note_id)

            connection.execute("""
                UPDATE notes
                SET pinned = ?, updated_at = ?
                WHERE id = ?
            """, (
                int(pin_data.pinned),
                current_time(),
                note_id
            ))

            row = connection.execute(
                "SELECT * FROM notes WHERE id = ?",
                (note_id,)
            ).fetchone()

        return serialize_note(row)

    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=str(error))


# ---------- Delete a note ----------

@app.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    try:
        with get_connection() as connection:
            cursor = connection.execute(
                "DELETE FROM notes WHERE id = ?",
                (note_id,)
            )

            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=404,
                    detail="Note not found"
                )

        return Response(status_code=204)

    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail=str(error))