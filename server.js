const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");

// Ordner + Datei sicherstellen
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");

// Logging Funktion
function logRequest(method, url, status, msg = "") {
  const time = new Date().toISOString();
  console.log(`[${time}] ${method} ${url} -> ${status}${msg ? " | " + msg : ""}`);
}

// JSON sicher parsen
function safeParseJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function loadUsers() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const users = JSON.parse(raw || "[]");
    return users.map(normalizeUser);
  } catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}

function normalizeUser(u) {
  if (!u) u = {};
  if (!u.id) u.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  if (!u.name && u.username) u.name = u.username;
  if (!u.subjects) u.subjects = {};
  for (const k of Object.keys(u.subjects)) {
    const val = u.subjects[k];
    if (typeof val === "number") u.subjects[k] = { count: val, goal: 0 };
    else if (val && typeof val === "object") {
      if (typeof val.count !== "number") val.count = Number(val.count) || 0;
      if (typeof val.goal !== "number") val.goal = Number(val.goal) || 0;
    } else u.subjects[k] = { count: 0, goal: 0 };
  }
  if (!u.history) u.history = {};
  for (const day of Object.keys(u.history)) {
    const map = u.history[day] || {};
    for (const subj of Object.keys(map)) map[subj] = Number(map[subj]) || 0;
    u.history[day] = map;
  }
  if (!u.lastActiveDay) u.lastActiveDay = null;
  return u;
}

function hashPassword(pw) {
  return crypto.createHash("sha256").update(String(pw)).digest("hex");
}

function collectRequestBody(req, cb) {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => cb(body));
}

const server = http.createServer((req, res) => {
  const now = new Date(); // globales Datum für diese Anfrage

// --- Statische Dateien ---
if (req.method === "GET" && (
    req.url === "/" || 
    req.url.endsWith(".html") || 
    req.url.endsWith(".js") || 
    req.url.endsWith(".css") || 
    req.url.endsWith(".ico") || 
    req.url.endsWith(".png") ||
    req.url.endsWith(".json") // <-- manifest.json wird hiermit erkannt
)) {
  const filePath = path.join(__dirname, "public", req.url === "/" ? "index.html" : decodeURIComponent(req.url));
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      logRequest(req.method, req.url, 404, "Static file not found");
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".ico": "image/x-icon",
      ".png": "image/png",
      ".json": "application/json; charset=utf-8" // <-- manifest.json korrekt ausliefern
    };
    res.writeHead(200, { "Content-Type": map[ext] || "application/octet-stream" });
    logRequest(req.method, req.url, 200, "Static file served");
    res.end(content);
  });
  return;
}

  // --- Register ---
  if (req.method === "POST" && req.url === "/register") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { name, email, password } = body;
      if (!name || !email || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Fehlende Felder");
        return res.end(JSON.stringify({ error: "Fehlende Felder" }));
      }
      const users = loadUsers();
      if (users.find(u => u.email === email)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "E-Mail bereits registriert");
        return res.end(JSON.stringify({ error: "E-Mail bereits registriert" }));
      }
      const newUser = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        name, email, password: hashPassword(password),
        subjects: {}, history: {}, lastActiveDay: now.toISOString().slice(0, 10)
      };
      users.push(newUser);
      saveUsers(users);
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `User registriert: ${email}`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // --- Login ---
  if (req.method === "POST" && req.url === "/login") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { email, password } = body;
      const users = loadUsers();
      const user = users.find(u => u.email === email && u.password === hashPassword(password));
      if (!user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 401, "Login fehlgeschlagen");
        return res.end(JSON.stringify({ error: "Ungültige Login-Daten" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Login erfolgreich: ${email}`);
      res.end(JSON.stringify({ user: { id: user.id, name: user.name, email: user.email } }));
    });
    return;
  }

  // --- User-Daten abrufen ---
  if (req.method === "GET" && req.url.startsWith("/user")) {
    try {
      const url = new URL(req.url, "http://localhost:" + PORT);
      const id = url.searchParams.get("id");
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "ID fehlt");
        return res.end(JSON.stringify({ error: "ID erforderlich" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User nicht gefunden");
        return res.end(JSON.stringify({ error: "User nicht gefunden" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `User abgerufen: ${user.email}`);
      res.end(JSON.stringify({ name: user.name, email: user.email }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 500, "Server error");
      res.end(JSON.stringify({ error: "Server error" }));
    }
    return;
  }

  // --- Stats Route ---
  if (req.method === "GET" && req.url.startsWith("/stats")) {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const id = url.searchParams.get("id");
      const offsetRaw = url.searchParams.get("offset");
      const offset = Number.isFinite(Number(offsetRaw)) ? parseInt(offsetRaw, 10) : 0;
      if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "ID fehlt");
        return res.end(JSON.stringify({ error: "ID erforderlich" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User nicht gefunden");
        return res.end(JSON.stringify({ error: "User nicht gefunden" }));
      }

      const base = new Date();
      base.setDate(base.getDate() + (offset * 7));

      const weekLabels = [];
      const weekValues = [];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);
        const dayStr = d.toISOString().slice(0, 10);
        weekLabels.push(dayStr);

        const dayHistory = user.history[dayStr] || {};
        const dayTotal = Object.values(dayHistory).reduce((a, b) => a + Number(b || 0), 0);
        weekValues.push(dayTotal);
      }

      const today = new Date();
      let streak = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dayStr = d.toISOString().slice(0, 10);
        const dayHistory = user.history[dayStr] || {};
        const sum = Object.values(dayHistory).reduce((a, b) => a + Number(b || 0), 0);
        if (sum > 0) streak++;
        else break;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Stats geladen (offset=${offset}) für ${user.email || user.name || user.id}`);
      return res.end(JSON.stringify({
        week: { labels: weekLabels, values: weekValues },
        currentStreak: streak
      }));

    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 500, "Server error (stats)");
      return res.end(JSON.stringify({ error: "Server error" }));
    }
  }

  // --- Subjects GET ---
  if (req.method === "GET" && req.url.startsWith("/subjects")) {
    try {
      const url = new URL(req.url, "http://localhost:" + PORT);
      const id = url.searchParams.get("id");
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User nicht gefunden");
        return res.end(JSON.stringify({ error: "User nicht gefunden" }));
      }

      const today = now.toISOString().slice(0, 10);
      if (user.lastActiveDay !== today) {
        if (user.lastActiveDay) {
          if (!user.history[user.lastActiveDay]) user.history[user.lastActiveDay] = {};
          for (const subj of Object.keys(user.subjects))
            user.history[user.lastActiveDay][subj] = Number(user.subjects[subj].count || 0);
        }
        if (!user.history[today]) user.history[today] = {};
        for (const subj of Object.keys(user.subjects)) user.subjects[subj].count = 0;
        user.lastActiveDay = today;
        saveUsers(users);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, "Subjects geladen");
      res.end(JSON.stringify({ subjects: user.subjects || {}, history: user.history || {} }));
    } catch {
      res.writeHead(500);
      logRequest(req.method, req.url, 500, "Server error");
      res.end("Server error");
    }
    return;
  }

  // --- /subjects/add ---
  if (req.method === "POST" && req.url === "/subjects/add") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { id, subject } = body;
      if (!id || !subject) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Fehlende Felder");
        return res.end(JSON.stringify({ error: "Fehlende Felder" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User nicht gefunden");
        return res.end(JSON.stringify({ error: "User nicht gefunden" }));
      }
      if (!user.subjects[subject]) user.subjects[subject] = { count: 0, goal: 0 };
      saveUsers(users);
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Fach hinzugefügt: ${subject}`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // --- /subjects/update ---
  if (req.method === "POST" && req.url === "/subjects/update") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { id, subject, delta } = body;
      if (!id || !subject || delta == null) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Fehlende Felder");
        return res.end(JSON.stringify({ error: "Fehlende Felder" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user || !user.subjects[subject]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User oder Fach nicht gefunden");
        return res.end(JSON.stringify({ error: "User oder Fach nicht gefunden" }));
      }
      user.subjects[subject].count += Number(delta);
      if (user.subjects[subject].count < 0) user.subjects[subject].count = 0;

      const today = now.toISOString().slice(0, 10);
      if (!user.history[today]) user.history[today] = {};
      user.history[today][subject] = user.subjects[subject].count;

      saveUsers(users);
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Fach aktualisiert: ${subject}`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // --- /subjects/delete ---
  if (req.method === "POST" && req.url === "/subjects/delete") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { id, subject } = body;
      if (!id || !subject) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Fehlende Felder");
        return res.end(JSON.stringify({ error: "Fehlende Felder" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user || !user.subjects[subject]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User oder Fach nicht gefunden");
        return res.end(JSON.stringify({ error: "User oder Fach nicht gefunden" }));
      }
      delete user.subjects[subject];
      saveUsers(users);
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Fach gelöscht: ${subject}`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // --- /subjects/goal ---
  if (req.method === "POST" && req.url === "/subjects/goal") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { id, subject, goal } = body;
      if (!id || !subject || goal == null) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Fehlende Felder");
        return res.end(JSON.stringify({ error: "Fehlende Felder" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user || !user.subjects[subject]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User oder Fach nicht gefunden");
        return res.end(JSON.stringify({ error: "User oder Fach nicht gefunden" }));
      }
      user.subjects[subject].goal = Number(goal);
      saveUsers(users);
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Ziel gesetzt: ${subject} -> ${goal}`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // --- /subjects/rename (neu) ---
  if (req.method === "POST" && req.url === "/subjects/rename") {
    collectRequestBody(req, (raw) => {
      const body = safeParseJson(raw) || {};
      const { id, oldName, newName } = body;
      if (!id || !oldName || !newName) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Fehlende Felder für Rename");
        return res.end(JSON.stringify({ error: "Fehlende Felder" }));
      }
      const users = loadUsers();
      const user = users.find(u => u.id === id);
      if (!user || !user.subjects[oldName]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 404, "User oder altes Fach nicht gefunden");
        return res.end(JSON.stringify({ error: "User oder altes Fach nicht gefunden" }));
      }
      if (user.subjects[newName]) {
        res.writeHead(400, { "Content-Type": "application/json" });
        logRequest(req.method, req.url, 400, "Neuer Fachname existiert bereits");
        return res.end(JSON.stringify({ error: "Neuer Fachname existiert bereits" }));
      }

      user.subjects[newName] = user.subjects[oldName];
      delete user.subjects[oldName];

      for (const day of Object.keys(user.history)) {
        if (user.history[day][oldName] != null) {
          user.history[day][newName] = user.history[day][oldName];
          delete user.history[day][oldName];
        }
      }

      saveUsers(users);
      res.writeHead(200, { "Content-Type": "application/json" });
      logRequest(req.method, req.url, 200, `Fach umbenannt: ${oldName} -> ${newName}`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  logRequest(req.method, req.url, 404, "Route nicht gefunden");
  res.end("Not Found");
});

server.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));

// --- Täglicher Reset um 01:00 Uhr ---
function resetDailyAtOne() {
  const now = new Date();
  const today = now.toISOString().slice(0,10);
  const users = loadUsers();

  const archiveFile = path.join(DATA_DIR, `archive-${today}.json`);
  fs.writeFileSync(archiveFile, JSON.stringify(users, null, 2), "utf8");

  for (const user of users) {
    if (user.lastActiveDay && user.lastActiveDay !== today) {
      if (!user.history[user.lastActiveDay]) user.history[user.lastActiveDay] = {};
      for (const subj of Object.keys(user.subjects))
        user.history[user.lastActiveDay][subj] = user.subjects[subj].count;
    }
    for (const subj of Object.keys(user.subjects)) user.subjects[subj].count = 0;
    user.lastActiveDay = today;
  }

  saveUsers(users);

  const next = new Date();
  next.setDate(next.getDate()+1);
  next.setHours(1,0,0,0);
  setTimeout(resetDailyAtOne, next - new Date());
}

resetDailyAtOne();
