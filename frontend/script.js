
"use strict";

/* =========================================
   Voice Notes - Normal JavaScript Version
   Backend: http://127.0.0.1:8000
   ========================================= */

const API_BASE = "http://127.0.0.1:8000";

/* ---------- HTML elements ---------- */

const noteForm = document.getElementById("noteForm");
const noteTitle = document.getElementById("noteTitle");
const noteContent = document.getElementById("noteContent");

const editorHeading = document.getElementById("editorHeading");
const saveNoteButton = document.getElementById("saveNote");
const clearEditorButton = document.getElementById("clearEditor");
const cancelEditButton = document.getElementById("cancelEdit");

const startRecordingButton = document.getElementById("startRecording");
const stopRecordingButton = document.getElementById("stopRecording");
const recognitionLanguage = document.getElementById("recognitionLanguage");
const recordingStatus = document.getElementById("recordingStatus");

const wordCount = document.getElementById("wordCount");
const notesList = document.getElementById("notesList");
const notesSummary = document.getElementById("notesSummary");
const searchNotes = document.getElementById("searchNotes");
const refreshNotesButton = document.getElementById("refreshNotes");

const themeToggle = document.getElementById("themeToggle");
const connectionStatus = document.getElementById("connectionStatus");
const statusIndicator = document.getElementById("statusIndicator");
const toastElement = document.getElementById("toast");

/* ---------- App state ---------- */

let notes = [];
let editingNoteId = null;
let recognition = null;
let isRecording = false;
let toastTimeout = null;

/* ---------- Notifications ---------- */

function showToast(message, isError = false) {
    if (!toastElement) return;

    toastElement.textContent = message;
    toastElement.classList.add("show");
    toastElement.classList.toggle("error", isError);

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
        toastElement.classList.remove("show", "error");
    }, 3000);
}

/* ---------- Server requests ---------- */

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });

    if (!response.ok) {
        let message = `Request failed (${response.status})`;

        try {
            const errorData = await response.json();
            message = errorData.detail || message;
        } catch {
            // Keep the default error message.
        }

        throw new Error(message);
    }

    if (response.status === 204) {
        return null;
    }

    return response.json();
}

async function checkServerConnection() {
    try {
        await apiRequest("/health");

        connectionStatus.textContent = "Server connected";
        statusIndicator.classList.add("online");
        statusIndicator.classList.remove("offline");
    } catch (error) {
        connectionStatus.textContent = "Server unavailable — start the backend";
        statusIndicator.classList.add("offline");
        statusIndicator.classList.remove("online");
    }
}

/* ---------- Text statistics ---------- */

function updateWordCount() {
    const text = noteContent.value.trim();
    const words = text ? text.split(/\s+/).length : 0;

    wordCount.textContent =
        `${words} words · ${noteContent.value.length} characters`;
}

noteContent.addEventListener("input", updateWordCount);

/* ---------- Editor controls ---------- */

function resetEditor() {
    noteForm.reset();
    editingNoteId = null;

    editorHeading.textContent = "Create a note";
    saveNoteButton.textContent = "💾 Save note";

    cancelEditButton.hidden = true;

    recordingStatus.textContent = "Ready to write";
    recordingStatus.classList.remove("recording");

    updateWordCount();
}

clearEditorButton.addEventListener("click", () => {
    resetEditor();
    showToast("Editor cleared");
});

cancelEditButton.addEventListener("click", resetEditor);

/* ---------- Create and update notes ---------- */

noteForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const title = noteTitle.value.trim();
    const content = noteContent.value.trim();

    if (!content) {
        showToast("Please enter some note content.", true);
        noteContent.focus();
        return;
    }

    const payload = {
        title: title || "Untitled note",
        content
    };

    saveNoteButton.disabled = true;
    saveNoteButton.textContent = "Saving...";

    try {
        if (editingNoteId !== null) {
            await apiRequest(`/notes/${editingNoteId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });

            showToast("Note updated successfully");
        } else {
            await apiRequest("/notes", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            showToast("Note saved successfully");
        }

        resetEditor();
        await loadNotes();
    } catch (error) {
        showToast(`Could not save note: ${error.message}`, true);
    } finally {
        saveNoteButton.disabled = false;
        saveNoteButton.textContent =
            editingNoteId !== null ? "💾 Update note" : "💾 Save note";
    }
});

/* ---------- Load notes ---------- */

async function loadNotes() {
    notesList.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">⏳</div>
            <h3>Loading notes...</h3>
        </div>
    `;

    try {
        const data = await apiRequest("/notes");

        notes = Array.isArray(data) ? data : (data.notes || []);

        renderNotes();
        checkServerConnection();
    } catch (error) {
        notesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <h3>Unable to load notes</h3>
                <p>Check that the FastAPI backend is running on port 8000.</p>
            </div>
        `;

        notesSummary.textContent = "Could not load your notes.";
        checkServerConnection();
    }
}

/* ---------- Render notes safely ---------- */

function createActionButton(label, action, noteId, extraClass = "") {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = String(noteId);

    if (extraClass) {
        button.className = extraClass;
    }

    return button;
}

function renderNotes() {
    const query = searchNotes.value.trim().toLowerCase();

    const filteredNotes = notes.filter((note) => {
        const title = (note.title || "").toLowerCase();
        const content = (note.content || "").toLowerCase();

        return title.includes(query) || content.includes(query);
    });

    // Pinned notes first; otherwise newest first.
    filteredNotes.sort((a, b) => {
        const pinDifference = Number(Boolean(b.pinned)) -
            Number(Boolean(a.pinned));

        if (pinDifference !== 0) return pinDifference;

        const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
        const dateB = new Date(b.updated_at || b.created_at || 0).getTime();

        return dateB - dateA;
    });

    notesSummary.textContent =
        `${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"}` +
        (query ? " found" : " saved");

    notesList.replaceChildren();

    if (filteredNotes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";

        const icon = document.createElement("div");
        icon.className = "empty-icon";
        icon.textContent = query ? "🔎" : "📝";

        const heading = document.createElement("h3");
        heading.textContent = query ? "No matching notes" : "No notes yet";

        const paragraph = document.createElement("p");
        paragraph.textContent = query
            ? "Try a different search."
            : "Create your first note above.";

        empty.append(icon, heading, paragraph);
        notesList.appendChild(empty);
        return;
    }

    filteredNotes.forEach((note) => {
        const card = document.createElement("article");
        card.className = "note-card";

        if (note.pinned) {
            card.classList.add("pinned");
        }

        const header = document.createElement("div");
        header.className = "note-card-header";

        const titleArea = document.createElement("div");

        const title = document.createElement("h3");
        title.textContent = note.title || "Untitled note";

        const date = document.createElement("div");
        date.className = "note-date";
        date.textContent = formatDate(note.updated_at || note.created_at);

        titleArea.append(title, date);

        if (note.pinned) {
            const pinnedLabel = document.createElement("span");
            pinnedLabel.textContent = "📌 Pinned";
            pinnedLabel.className = "pinned-label";
            titleArea.appendChild(pinnedLabel);
        }

        header.appendChild(titleArea);

        const content = document.createElement("p");
        content.className = "note-content";
        content.textContent = note.content || "";

        const actions = document.createElement("div");
        actions.className = "note-actions";

        actions.append(
            createActionButton("✏️ Edit", "edit", note.id),
            createActionButton(
                note.pinned ? "📌 Unpin" : "📌 Pin",
                "pin",
                note.id
            ),
            createActionButton("📋 Copy", "copy", note.id),
            createActionButton("↗ Share", "share", note.id),
            createActionButton("🗑 Delete", "delete", note.id, "delete-note")
        );

        card.append(header, content, actions);
        notesList.appendChild(card);
    });
}

function formatDate(value) {
    if (!value) return "Date unavailable";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString();
}

/* ---------- Search ---------- */

searchNotes.addEventListener("input", renderNotes);

refreshNotesButton.addEventListener("click", loadNotes);

/* ---------- Find a note ---------- */

function findNote(noteId) {
    return notes.find((note) => String(note.id) === String(noteId));
}

/* ---------- Notes action buttons ---------- */

notesList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const action = button.dataset.action;
    const noteId = button.dataset.id;
    const note = findNote(noteId);

    if (!note) {
        showToast("Note not found. Refreshing notes.", true);
        await loadNotes();
        return;
    }

    if (action === "edit") {
        editingNoteId = note.id;

        noteTitle.value = note.title || "";
        noteContent.value = note.content || "";

        editorHeading.textContent = "Edit note";
        saveNoteButton.textContent = "💾 Update note";
        cancelEditButton.hidden = false;

        updateWordCount();

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

        noteContent.focus();
        return;
    }

    if (action === "pin") {
        button.disabled = true;

        try {
            await apiRequest(`/notes/${note.id}/pin`, {
                method: "PATCH",
                body: JSON.stringify({
                    pinned: !Boolean(note.pinned)
                })
            });

            showToast(note.pinned ? "Note unpinned" : "Note pinned");
            await loadNotes();
        } catch (error) {
            showToast(`Could not update pin: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }

        return;
    }

    if (action === "copy") {
        try {
            await navigator.clipboard.writeText(
                `${note.title || "Untitled note"}\n\n${note.content || ""}`
            );

            showToast("Note copied to clipboard");
        } catch {
            showToast("Clipboard access failed. Check browser permissions.", true);
        }

        return;
    }

    if (action === "share") {
        const shareData = {
            title: note.title || "Voice Note",
            text: `${note.title || "Untitled note"}\n\n${note.content || ""}`
        };

        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else {
                await navigator.clipboard.writeText(shareData.text);
                showToast("Sharing is unavailable; note copied instead.");
            }
        } catch (error) {
            if (error.name !== "AbortError") {
                showToast("Could not share this note.", true);
            }
        }

        return;
    }

    if (action === "delete") {
        const confirmed = window.confirm(
            `Delete "${note.title || "Untitled note"}"? This cannot be undone.`
        );

        if (!confirmed) return;

        button.disabled = true;

        try {
            await apiRequest(`/notes/${note.id}`, {
                method: "DELETE"
            });

            if (String(editingNoteId) === String(note.id)) {
                resetEditor();
            }

            showToast("Note deleted");
            await loadNotes();
        } catch (error) {
            showToast(`Could not delete note: ${error.message}`, true);
        } finally {
            button.disabled = false;
        }
    }
});

/* ---------- Voice dictation ---------- */

function setupSpeechRecognition() {
    const SpeechRecognitionAPI =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
        startRecordingButton.disabled = true;
        stopRecordingButton.disabled = true;

        recordingStatus.textContent =
            "Speech recognition is not supported in this browser";

        showToast("Use a supported version of Google Chrome for dictation.", true);
        return;
    }

    recognition = new SpeechRecognitionAPI();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = recognitionLanguage.value;

    let finalTranscript = "";
    let startingText = "";

    recognition.onstart = () => {
        isRecording = true;
        startingText = noteContent.value.trim();
        finalTranscript = "";

        startRecordingButton.disabled = true;
        stopRecordingButton.disabled = false;

        recordingStatus.textContent = "Listening...";
        recordingStatus.classList.add("recording");
    };

    recognition.onresult = (event) => {
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;

            if (event.results[i].isFinal) {
                finalTranscript += transcript + " ";
            } else {
                interimTranscript += transcript;
            }
        }

        const dictatedText = (finalTranscript + interimTranscript).trim();

        noteContent.value = [startingText, dictatedText]
            .filter(Boolean)
            .join(startingText && dictatedText ? "\n" : "");

        updateWordCount();
    };

    recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            showToast("Allow microphone access in your browser settings.", true);
        } else if (event.error === "no-speech") {
            recordingStatus.textContent = "No speech detected. Try again.";
        } else if (event.error !== "aborted") {
            showToast(`Speech recognition error: ${event.error}`, true);
        }
    };

    recognition.onend = () => {
        isRecording = false;

        startRecordingButton.disabled = false;
        stopRecordingButton.disabled = true;

        recordingStatus.textContent = "Ready to write";
        recordingStatus.classList.remove("recording");

        updateWordCount();
    };
}

startRecordingButton.addEventListener("click", () => {
    if (!recognition) {
        showToast("Speech recognition is unavailable.", true);
        return;
    }

    recognition.lang = recognitionLanguage.value;

    try {
        recognition.start();
    } catch (error) {
        showToast("Dictation is already running. Please wait.", true);
    }
});

stopRecordingButton.addEventListener("click", () => {
    if (recognition && isRecording) {
        recognition.stop();
        recordingStatus.textContent = "Stopping dictation...";
    }
});

/* ---------- Theme toggle ---------- */

function applyTheme(isDark) {
    document.body.classList.toggle("dark-mode", isDark);

    themeToggle.textContent = isDark ? "☀️ Light" : "🌙 Dark";
    themeToggle.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
    );
}

let darkMode = false;

try {
    darkMode = localStorage.getItem("voiceNotesTheme") === "dark";
} catch {
    // Theme preference storage may be unavailable.
}

applyTheme(darkMode);

themeToggle.addEventListener("click", () => {
    darkMode = !document.body.classList.contains("dark-mode");
    applyTheme(darkMode);

    try {
        localStorage.setItem("voiceNotesTheme", darkMode ? "dark" : "light");
    } catch {
        // The theme still changes for this session.
    }
});

/* ---------- Start app ---------- */

async function initializeApp() {
    updateWordCount();
    setupSpeechRecognition();

    await checkServerConnection();
    await loadNotes();
}

initializeApp();