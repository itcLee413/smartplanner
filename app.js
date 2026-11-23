process.env.TZ = 'Asia/Seoul';

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. Security & Middleware Configuration
// ==========================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'webplanner-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per IP
  message: '요청 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.'
});

// Flash & Session User helper middleware
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId ? {
    id: req.session.userId,
    username: req.session.username,
    name: req.session.name,
    role: req.session.role
  } : null;
  res.locals.errorMsg = req.session.errorMsg || null;
  res.locals.successMsg = req.session.successMsg || null;
  delete req.session.errorMsg;
  delete req.session.successMsg;
  next();
});

// ==========================================
// 2. Database Initialization (SQLite)
// ==========================================
const db = new Database(path.join(__dirname, 'database.sqlite'));
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'USER',
    telegram_link_code TEXT,
    telegram_chat_id TEXT,
    dashboard_layout TEXT,
    quick_memo TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_datetime TEXT,
    category TEXT DEFAULT '개인',
    status TEXT DEFAULT 'TODO',
    is_top3 INTEGER DEFAULT 0,
    is_important INTEGER DEFAULT 0,
    is_notified INTEGER DEFAULT 0,
    focus_minutes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    is_done INTEGER DEFAULT 0,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    message TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    invite_code TEXT UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    position TEXT DEFAULT '팀원',
    role TEXT DEFAULT 'MEMBER',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_datetime TEXT,
    status TEXT DEFAULT 'TODO',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    category TEXT DEFAULT '특이사항',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_schedule_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    schedule_id INTEGER,
    schedule_title TEXT,
    editor_id INTEGER NOT NULL,
    action_type TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (editor_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_top3_team_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    team_schedule_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, team_schedule_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_schedule_id) REFERENCES team_schedules(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    linked_type TEXT DEFAULT 'NONE',
    linked_schedule_id INTEGER,
    links_json TEXT DEFAULT '[]',
    attachments_json TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_custom_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    html_code TEXT DEFAULT '',
    css_code TEXT DEFAULT '',
    js_code TEXT DEFAULT '',
    default_w INTEGER DEFAULT 4,
    default_h INTEGER DEFAULT 3,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Migration: Ensure dashboard_layout and quick_memo exist in users table
try {
  db.exec(`ALTER TABLE users ADD COLUMN dashboard_layout TEXT;`);
} catch (e) {
  // column already exists
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN quick_memo TEXT DEFAULT '';`);
} catch (e) {
  // column already exists
}

// Ensure sort_order column exists in team_members for custom drag & drop ordering
try {
  db.exec(`ALTER TABLE team_members ADD COLUMN sort_order INTEGER DEFAULT 0;`);
} catch (e) {
  // column already exists
}

// Migration: Ensure due_datetime in schedules and team_schedules is nullable
try {
  const schedCol = db.prepare("PRAGMA table_info(schedules)").all().find(c => c.name === 'due_datetime');
  if (schedCol && schedCol.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE schedules_temp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          due_datetime TEXT,
          category TEXT DEFAULT '개인',
          status TEXT DEFAULT 'TODO',
          is_top3 INTEGER DEFAULT 0,
          is_important INTEGER DEFAULT 0,
          is_notified INTEGER DEFAULT 0,
          focus_minutes INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO schedules_temp SELECT * FROM schedules;
        DROP TABLE schedules;
        ALTER TABLE schedules_temp RENAME TO schedules;
      `);
    })();
    db.pragma('foreign_keys = ON');
  }

  const teamSchedCol = db.prepare("PRAGMA table_info(team_schedules)").all().find(c => c.name === 'due_datetime');
  if (teamSchedCol && teamSchedCol.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE team_schedules_temp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL,
          author_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          due_datetime TEXT,
          status TEXT DEFAULT 'TODO',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
          FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO team_schedules_temp SELECT * FROM team_schedules;
        DROP TABLE team_schedules;
        ALTER TABLE team_schedules_temp RENAME TO team_schedules;
      `);
    })();
    db.pragma('foreign_keys = ON');
  }
} catch (e) {
  console.error('Migration error for nullable due_datetime:', e);
}

// Helper to fix Korean / UTF-8 filename garbling from Multer / Busboy (latin1 -> utf-8)
function decodeOriginalname(name) {
  if (!name) return '';
  // If it already has characters beyond latin1 (code > 255), it's already decoded unicode (e.g. Hangul)
  if (/[^\x00-\xFF]/.test(name)) {
    return name;
  }
  // If it's purely ASCII (code <= 127), no multi-byte decoding needed
  if (!/[^\x00-\x7F]/.test(name)) {
    return name;
  }
  // Otherwise, it has bytes between 0x80 and 0xFF encoded as latin1.
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) {
      return decoded;
    }
  } catch (e) {}
  return name;
}

// Migration: Automatically fix any existing corrupted Korean attachment filenames in user_notes
try {
  const existingNotes = db.prepare(`SELECT id, attachments_json FROM user_notes WHERE attachments_json IS NOT NULL AND attachments_json != '[]'`).all();
  for (const n of existingNotes) {
    try {
      const atts = JSON.parse(n.attachments_json);
      let modified = false;
      for (const a of atts) {
        if (a.originalName) {
          const decoded = decodeOriginalname(a.originalName);
          if (decoded !== a.originalName) {
            a.originalName = decoded;
            modified = true;
          }
        }
      }
      if (modified) {
        db.prepare(`UPDATE user_notes SET attachments_json = ? WHERE id = ?`).run(JSON.stringify(atts), n.id);
        console.log(`[Migration] Healed Korean attachment filenames for note ID ${n.id}`);
      }
    } catch (err) {}
  }
} catch (e) {
  console.error('Note attachments migration error:', e);
}

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const noteStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const originalName = decodeOriginalname(file.originalname);
    file.originalname = originalName;
    const ext = path.extname(originalName).toLowerCase();
    const safeBase = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_\-\uAC00-\uD7A3]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${safeBase.slice(0, 30) || 'file'}${ext}`);
  }
});

const allowedAttachmentExts = ['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.md', '.docx', '.xlsx', '.zip'];

const uploadNoteAttachment = multer({
  storage: noteStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const originalName = decodeOriginalname(file.originalname);
    file.originalname = originalName;
    const ext = path.extname(originalName).toLowerCase();
    if (allowedAttachmentExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`허용되지 않은 파일 형식입니다. (허용 확장자: ${allowedAttachmentExts.join(', ')})`));
    }
  }
});

// Helper to log team schedule audit actions
function logTeamScheduleAction(teamId, scheduleId, scheduleTitle, editorId, actionType, detail) {
  try {
    db.prepare(`
      INSERT INTO team_schedule_logs (team_id, schedule_id, schedule_title, editor_id, action_type, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(teamId, scheduleId || null, scheduleTitle || '', editorId, actionType, detail || '');
  } catch (err) {
    console.error('Failed to log team schedule action:', err);
  }
}

// Helper to get current Korean Time formatted as YYYY-MM-DD HH:mm
function getKoreanTimeString(offsetMinutes = 0) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  const kst = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);
  
  const map = {};
  kst.forEach(p => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

function getKoreanDateString(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const kst = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  
  const map = {};
  kst.forEach(p => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

// Initialize system settings from .env if not exists
const initSetting = db.prepare(`INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)`);
initSetting.run('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
initSetting.run('bot_enabled', process.env.TELEGRAM_BOT_TOKEN ? 'true' : 'false');
initSetting.run('gemini_api_key', process.env.GEMINI_API_KEY || '');

function getSetting(key) {
  const row = db.prepare(`SELECT value FROM system_settings WHERE key = ?`).get(key);
  if (row && row.value !== null && row.value !== undefined) {
    return row.value;
  }
  if (key === 'telegram_bot_token') return process.env.TELEGRAM_BOT_TOKEN || '';
  if (key === 'gemini_api_key') return process.env.GEMINI_API_KEY || '';
  if (key === 'bot_enabled') return 'false';
  return '';
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

// ==========================================
// Modular Dashboard System Constants & Helpers (modules.md)
// ==========================================
const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'top3', x: 0, y: 0, w: 12, h: 3, enabled: true },
  { id: 'workspace', x: 0, y: 3, w: 8, h: 7, enabled: true },
  { id: 'stats', x: 8, y: 3, w: 4, h: 4, enabled: true },
  { id: 'quick_add', x: 8, y: 7, w: 4, h: 3, enabled: true },
  { id: 'clock', x: 0, y: 10, w: 4, h: 2, enabled: false },
  { id: 'memo', x: 4, y: 10, w: 4, h: 3, enabled: false }
];

const VALID_WIDGET_IDS = ['top3', 'workspace', 'stats', 'quick_add', 'clock', 'memo'];

const WIDGET_SPECS = {
  top3: { title: '오늘의 핵심 목표 Top 3', defaultW: 12, defaultH: 3, defaultEnabled: true },
  workspace: { title: '일정 워크스페이스 (칸반/캘린더/소속팀)', defaultW: 8, defaultH: 7, defaultEnabled: true },
  stats: { title: '카테고리별 생산성 통계 차트', defaultW: 4, defaultH: 4, defaultEnabled: true },
  quick_add: { title: '새 일정 빠른 등록 폼', defaultW: 4, defaultH: 3, defaultEnabled: true },
  clock: { title: '실시간 디지털 시계 & 오늘의 날짜', defaultW: 4, defaultH: 2, defaultEnabled: false },
  memo: { title: '빠른 포스트잇 메모장', defaultW: 4, defaultH: 3, defaultEnabled: false }
};

function getEffectiveDashboardLayout(savedLayoutJson, customWidgets = []) {
  let parsed = [];
  if (savedLayoutJson && typeof savedLayoutJson === 'string' && savedLayoutJson.trim()) {
    try {
      const p = JSON.parse(savedLayoutJson);
      if (Array.isArray(p)) parsed = p;
    } catch (e) {}
  }

  const result = [];
  // 1. Standard 6 widgets
  VALID_WIDGET_IDS.forEach(id => {
    const def = DEFAULT_DASHBOARD_LAYOUT.find(d => d.id === id);
    const found = parsed.find(item => item && item.id === id);
    if (found) {
      result.push({
        id,
        x: typeof found.x === 'number' ? Math.max(0, found.x) : def.x,
        y: typeof found.y === 'number' ? Math.max(0, found.y) : def.y,
        w: typeof found.w === 'number' ? Math.max(1, Math.min(12, found.w)) : def.w,
        h: typeof found.h === 'number' ? Math.max(1, found.h) : def.h,
        enabled: found.enabled !== undefined ? Boolean(found.enabled) : def.enabled
      });
    } else {
      result.push(JSON.parse(JSON.stringify(def)));
    }
  });

  // Calculate current maximum Y to position custom widgets cleanly
  let maxY = 0;
  result.forEach(item => {
    if (item.enabled) {
      const bottom = (item.y || 0) + (item.h || 2);
      if (bottom > maxY) maxY = bottom;
    }
  });

  // 2. Custom widgets (moduleplus.md)
  if (Array.isArray(customWidgets)) {
    customWidgets.forEach(cw => {
      const customId = 'custom_' + cw.id;
      const found = parsed.find(item => item && item.id === customId);
      if (found) {
        result.push({
          id: customId,
          x: typeof found.x === 'number' ? Math.max(0, found.x) : 0,
          y: typeof found.y === 'number' ? Math.max(0, found.y) : maxY,
          w: typeof found.w === 'number' ? Math.max(1, Math.min(12, found.w)) : (cw.default_w || 4),
          h: typeof found.h === 'number' ? Math.max(1, found.h) : (cw.default_h || 3),
          enabled: found.enabled !== undefined ? Boolean(found.enabled) : true
        });
      } else {
        result.push({
          id: customId,
          x: 0,
          y: maxY,
          w: cw.default_w || 4,
          h: cw.default_h || 3,
          enabled: true
        });
        maxY += (cw.default_h || 3);
      }
    });
  }

  return result;
}

// WorkSmarter Notion-Style Common Design System srcdoc builder for Custom Widgets (moduleplus.md)
function buildCustomWidgetSrcdoc(htmlCode, cssCode, jsCode) {
  const commonCss = `
    :root {
      --ws-bg: #FFFFFF;
      --ws-sub-bg: #F7F7F5;
      --ws-border: #E9E9E7;
      --ws-text: #37352F;
      --ws-muted: #787774;
      --ws-accent: #2383E2;
      --ws-radius: 6px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #37352F;
      background: #FFFFFF;
      font-size: 13px;
      line-height: 1.5;
    }
    .ws-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: var(--ws-radius);
      border: 1px solid var(--ws-border);
      background: var(--ws-bg);
      color: var(--ws-text);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      text-decoration: none;
    }
    .ws-btn:hover {
      background: var(--ws-sub-bg);
      border-color: #D3D3D0;
    }
    .ws-btn-primary {
      background: var(--ws-accent);
      color: #FFFFFF;
      border: 1px solid var(--ws-accent);
    }
    .ws-btn-primary:hover {
      background: #1a6fbf;
      border-color: #1a6fbf;
    }
    .ws-input {
      width: 100%;
      padding: 6px 10px;
      font-size: 13px;
      border: 1px solid var(--ws-border);
      border-radius: var(--ws-radius);
      background: var(--ws-bg);
      color: var(--ws-text);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .ws-input:focus {
      border-color: var(--ws-accent);
      box-shadow: 0 0 0 2px rgba(35, 131, 226, 0.15);
    }
    .ws-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 500;
      border-radius: 4px;
      background: var(--ws-sub-bg);
      color: var(--ws-muted);
      border: 1px solid var(--ws-border);
    }
    .ws-card {
      background: var(--ws-sub-bg);
      border: 1px solid var(--ws-border);
      border-radius: var(--ws-radius);
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .ws-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--ws-text);
      margin: 0 0 6px 0;
    }
    .ws-muted {
      color: var(--ws-muted);
      font-size: 12px;
    }
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">
  <style>
${commonCss}
${cssCode || ''}
  </style>
</head>
<body>
${htmlCode || ''}
<script>
  try {
${jsCode || ''}
  } catch (err) {
    console.error("Custom widget script execution error:", err);
  }
<\/script>
</body>
</html>`;
}

// Initial dummy data creation
const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
if (userCount === 0) {
  console.log('초기 더미 데이터(관리자 및 테스트 사용자)를 생성합니다...');
  const salt = bcrypt.genSaltSync(10);
  const adminHash = bcrypt.hashSync('admin1234', salt);
  const testHash = bcrypt.hashSync('1234', salt);

  const insertUser = db.prepare(`INSERT INTO users (username, password, name, role, telegram_link_code) VALUES (?, ?, ?, ?, ?)`);
  insertUser.run('admin', adminHash, '시스템관리자', 'ADMIN', 'ADM001');
  const testUserRes = insertUser.run('test', testHash, '홍길동', 'USER', 'TST123');
  const testUserId = testUserRes.lastInsertRowid;

  const todayStr = getKoreanDateString(0);
  const tomorrowStr = getKoreanDateString(1);

  const insertSchedule = db.prepare(`
    INSERT INTO schedules (user_id, title, description, due_datetime, category, status, is_top3, is_important)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSubtask = db.prepare(`INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)`);

  // Sample Schedule 1 (Top 3 & Important)
  const s1 = insertSchedule.run(
    testUserId,
    'AWS EC2 배포 및 발표자료 최종 리허설',
    '1. 서론: 프로젝트 배경 및 시스템 아키텍처 요약\n2. 본론: EC2 Ubuntu 배포 환경 및 PM2 무중단 구동 시연\n3. 결론: 텔레그램 스마트 비서 실시간 브리핑 데모',
    `${todayStr} 17:00`,
    '팀프로젝트',
    'IN_PROGRESS',
    1,
    1
  );
  insertSubtask.run(s1.lastInsertRowid, 'EC2 인스턴스 보안그룹 포트 및 도메인 바인딩 점검', 1);
  insertSubtask.run(s1.lastInsertRowid, '텔레그램 봇 /link 코드 연동 및 즉시 브리핑 테스트', 1);
  insertSubtask.run(s1.lastInsertRowid, '발표 슬라이드 10분 타임어택 최종 리허설', 0);

  // Sample Schedule 2
  const s2 = insertSchedule.run(
    testUserId,
    '알고리즘 문제 풀이 및 포모도로 4세트',
    '백준/프로그래머스 그래프 탐색(BFS/DFS) 및 DP 기출 3문제 풀이\n포모도로 25분 x 4세트 몰입 집중 실행',
    `${todayStr} 21:00`,
    '자기계발',
    'TODO',
    0,
    0
  );
  insertSubtask.run(s2.lastInsertRowid, '백준 1260번 DFS와 BFS 풀이 및 검증', 0);
  insertSubtask.run(s2.lastInsertRowid, '백준 2667번 단지번호붙이기 풀이', 0);
  insertSubtask.run(s2.lastInsertRowid, '오답 노트 정리 및 핵심 시간복잡도 기록', 0);

  // Sample Schedule 3 (Top 3 & Important)
  const s3 = insertSchedule.run(
    testUserId,
    '클라우드 컴퓨팅 종합 보고서 제출',
    'GitHub 리포지토리 README.md 배포 가이드 최신화\n동작 영상 링크 첨부 및 PDF 변환 후 과제방 업로드',
    `${tomorrowStr} 14:00`,
    '업무',
    'TODO',
    1,
    1
  );
  insertSubtask.run(s3.lastInsertRowid, 'README.md 내 EC2 배포 명령어 및 환경변수 가이드 검증', 1);
  insertSubtask.run(s3.lastInsertRowid, '과제 제출 양식 최종 서명 및 PDF 업로드', 0);

  console.log('초기 데이터베이스 설정 완료: test(1234) / admin(admin1234)');
}

// Check and create sample team dummy data
const teamCount = db.prepare(`SELECT COUNT(*) as count FROM teams`).get().count;
if (teamCount === 0) {
  const testUser = db.prepare(`SELECT id FROM users WHERE username = 'test'`).get();
  if (testUser) {
    const todayStr = getKoreanDateString(0);
    const tomorrowStr = getKoreanDateString(1);

    const teamInsert = db.prepare(`
      INSERT INTO teams (name, description, invite_code, owner_id)
      VALUES (?, ?, ?, ?)
    `).run(
      '스마트팩토리 네트워크 구축팀',
      '스마트팩토리 센서 데이터 수집 IoT 게이트웨이 및 실시간 관제 시스템 구축 팀입니다.',
      'SFNET2026',
      testUser.id
    );
    const sampleTeamId = teamInsert.lastInsertRowid;

    // Team Leader member
    db.prepare(`
      INSERT INTO team_members (team_id, user_id, position, role)
      VALUES (?, ?, ?, ?)
    `).run(sampleTeamId, testUser.id, '팀장', 'LEADER');

    // Sample Team Schedules (2개)
    const insertTeamSched = db.prepare(`
      INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertTeamSched.run(
      sampleTeamId,
      testUser.id,
      '공장 IoT 센서 디바이스 프로토콜 연동 테스트',
      'Modbus/MQTT 프로토콜 패킷 데이터 수신 검증 및 게이트웨이 지연시간 50ms 이내 유지 테스트',
      `${todayStr} 16:00`,
      'IN_PROGRESS'
    );
    insertTeamSched.run(
      sampleTeamId,
      testUser.id,
      '중간 발표 데모 시나리오 점검 및 네트워크 보안 점검',
      'VPN 망 분리 및 방화벽 인바운드 룰 최종 확인, 시연 동선 및 발표 슬라이드 점검',
      `${tomorrowStr} 15:00`,
      'TODO'
    );

    // Sample Team Note (1개, 공지)
    db.prepare(`
      INSERT INTO team_notes (team_id, author_id, category, title, content, is_pinned)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sampleTeamId,
      testUser.id,
      '공지',
      '[필독] 게이트웨이 펌웨어 업데이트 시 사전 공지 필수',
      '각 작업 구역 PLC 및 게이트웨이 펌웨어 배포 시 반드시 30분 전 슬랙 및 팀 공지로 알림 후 진행해 주세요. 비인가 포트 개방은 엄격히 금지됩니다.',
      1
    );

    console.log('샘플 팀 더미 데이터 생성 완료: 스마트팩토리 네트워크 구축팀 (초대코드: SFNET2026)');
  }
}

// ==========================================
// 2-1. Team Leader Auto-Repair & Safe Promotion Helper
// ==========================================
function ensureTeamLeader(teamId) {
  if (!teamId) return null;
  const tid = parseInt(teamId, 10);
  if (isNaN(tid)) return null;

  const team = db.prepare('SELECT id, owner_id FROM teams WHERE id = ?').get(tid);
  if (!team) return null;

  // 1. 유령 팀 체크: 멤버가 아예 0명인 유령 팀 자동 정리
  const totalMemberCount = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?').get(tid).count;
  if (totalMemberCount === 0) {
    console.log(`[Auto-Repair] 멤버가 0명인 유령 팀(ID: ${tid})을 자동 정리합니다.`);
    const cleanGhostTx = db.transaction((id) => {
      db.prepare('DELETE FROM team_schedule_logs WHERE team_id = ?').run(id);
      db.prepare('DELETE FROM team_notes WHERE team_id = ?').run(id);
      db.prepare('DELETE FROM team_schedules WHERE team_id = ?').run(id);
      db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
      db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    });
    cleanGhostTx(tid);
    return null;
  }

  // 2. 리더(role = 'LEADER') 존재 여부 확인
  const leaderCount = db.prepare(`SELECT COUNT(*) as count FROM team_members WHERE team_id = ? AND role = 'LEADER'`).get(tid).count;
  if (leaderCount === 0) {
    // joined_at ASC, id ASC 기준 가장 먼저 들어온 멤버 1명 (혼자 남은 팀이라면 그 본인)
    const oldestMember = db.prepare(`
      SELECT id, user_id, position, role
      FROM team_members 
      WHERE team_id = ? 
      ORDER BY joined_at ASC, id ASC 
      LIMIT 1
    `).get(tid);

    if (oldestMember) {
      const newPosition = (oldestMember.position === '팀원' || !oldestMember.position) ? '팀장' : oldestMember.position;
      const promoteTx = db.transaction(() => {
        // 1) 해당 멤버의 role을 'LEADER'로 업데이트 (직책이 '팀원'이면 '팀장'으로 함께 변경)
        db.prepare(`
          UPDATE team_members 
          SET role = 'LEADER', position = ? 
          WHERE id = ?
        `).run(newPosition, oldestMember.id);

        // 2) teams 테이블의 owner_id도 해당 멤버의 user_id로 업데이트
        db.prepare(`
          UPDATE teams 
          SET owner_id = ? 
          WHERE id = ?
        `).run(oldestMember.user_id, tid);
      });
      promoteTx();
      console.log(`[Auto-Repair] 팀(ID: ${tid})에 리더가 없어 최고참 멤버(ID: ${oldestMember.id}, UserID: ${oldestMember.user_id})를 리더(LEADER)로 자동 승급 완료`);
      return oldestMember;
    }
  } else {
    // 리더는 있으나 teams.owner_id가 현재 리더 중 한 명이 아닌 경우 데이터 일관성 보정
    const ownerMember = db.prepare(`SELECT id, role FROM team_members WHERE team_id = ? AND user_id = ?`).get(tid, team.owner_id);
    if (!ownerMember || ownerMember.role !== 'LEADER') {
      const currentLeader = db.prepare(`
        SELECT user_id FROM team_members 
        WHERE team_id = ? AND role = 'LEADER' 
        ORDER BY joined_at ASC, id ASC 
        LIMIT 1
      `).get(tid);
      if (currentLeader) {
        db.prepare(`UPDATE teams SET owner_id = ? WHERE id = ?`).run(currentLeader.user_id, tid);
      }
    }
  }

  return null;
}

// 서버 시작 시 일괄 복구 로직 (DB 초기화 직후 실행)
function repairAllTeamsWithoutLeader() {
  try {
    const allTeams = db.prepare('SELECT id FROM teams').all();
    for (const team of allTeams) {
      ensureTeamLeader(team.id);
    }
  } catch (err) {
    console.error('Failed to repair teams without leader on startup:', err);
  }
}

// DB 초기화 직후 일괄 복구 즉시 실행
repairAllTeamsWithoutLeader();

// ==========================================
// 3. Telegram Rich Briefing & Bot Engine
// ==========================================

// Rich Briefing Formatter
function formatScheduleBriefing(schedule, subtasks = []) {
  let msg = `[중요 일정 알림]\n• 일정: ${schedule.title}\n• 시간: ${schedule.due_datetime}\n• 카테고리: ${schedule.category || '기타'}`;

  if (schedule.description && schedule.description.trim()) {
    msg += `\n\n[세부 메모 & 진행 순서]\n${schedule.description.trim()}`;
  }

  if (subtasks && subtasks.length > 0) {
    const completedCount = subtasks.filter(s => s.is_done === 1).length;
    const percent = Math.round((completedCount / subtasks.length) * 100);
    msg += `\n\n[실행 체크리스트 (진행률 ${percent}%)]\n` +
      subtasks.map(s => `${s.is_done === 1 ? '☑' : '☐'} ${s.title}`).join('\n');
  }

  return msg;
}

// Telegram Message Sender
async function sendTelegramMessage(chatId, text, userId = null, type = 'SCHEDULE_ALERT') {
  const token = getSetting('telegram_bot_token');
  if (!token || !chatId) {
    if (userId) {
      db.prepare(`INSERT INTO notification_logs (user_id, type, message, status) VALUES (?, ?, ?, ?)`).run(
        userId, type, text.slice(0, 500), 'FAILED'
      );
    }
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text
      })
    });
    const data = await res.json();
    const status = data.ok ? 'SUCCESS' : 'FAILED';
    if (userId) {
      db.prepare(`INSERT INTO notification_logs (user_id, type, message, status) VALUES (?, ?, ?, ?)`).run(
        userId, type, text.slice(0, 500), status
      );
    }
    return data.ok;
  } catch (err) {
    console.error('텔레그램 발송 오류:', err.message);
    if (userId) {
      db.prepare(`INSERT INTO notification_logs (user_id, type, message, status) VALUES (?, ?, ?, ?)`).run(
        userId, type, text.slice(0, 500), 'FAILED'
      );
    }
    return false;
  }
}

// 1:1 Telegram Polling Engine (3초 주기)
let lastUpdateId = 0;
let isPolling = false;

async function pollTelegramBot() {
  if (isPolling) return;
  const botEnabled = getSetting('bot_enabled') === 'true';
  const token = getSetting('telegram_bot_token');

  if (!botEnabled || !token) {
    return;
  }

  isPolling = true;
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=2`;
    const res = await fetch(url);
    if (!res.ok) {
      isPolling = false;
      return;
    }
    const data = await res.json();

    if (data.ok && Array.isArray(data.result)) {
      for (const update of data.result) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = String(msg.chat.id);
        const text = msg.text.trim();

        // 1. /link [코드] or /start [코드]
        if (text.startsWith('/link') || text.startsWith('/start')) {
          const parts = text.split(/\s+/);
          const code = parts[1] ? parts[1].trim() : '';

          if (!code) {
            await sendTelegramMessage(chatId, `⚠️ 연동 코드를 함께 입력해 주세요.\n예: /link ABC123\n(웹 마이페이지나 대시보드 우측 패널에서 연동 코드를 발급받을 수 있습니다.)`);
            continue;
          }

          const targetUser = db.prepare(`SELECT * FROM users WHERE telegram_link_code = ?`).get(code);
          if (targetUser) {
            db.prepare(`UPDATE users SET telegram_chat_id = ? WHERE id = ?`).run(chatId, targetUser.id);
            const welcomeText = `🎉 반갑습니다, ${targetUser.name}님!\nWorkSmarter 스마트 비서와 성공적으로 연동되었습니다.\n\n앞으로 등록하신 중요 일정 알림과 포모도로 집중 완료 피드백을 실시간으로 브리핑해 드립니다.\n\n[사용 가능한 명령어]\n• /오늘일정 : 오늘 예정된 일정과 체크리스트 브리핑\n• /완료 [일정ID] : 해당 일정 완료(DONE) 처리\n• /도움말 : 안내 다시 보기`;
            await sendTelegramMessage(chatId, welcomeText, targetUser.id, 'TEST_ALERT');
          } else {
            await sendTelegramMessage(chatId, `❌ 일치하는 연동 코드를 찾을 수 없습니다.\n웹 화면에서 새로고침하여 코드를 확인해 주세요.`);
          }
          continue;
        }

        // Check if user is linked
        const user = db.prepare(`SELECT * FROM users WHERE telegram_chat_id = ?`).get(chatId);

        // 2. /오늘일정
        if (text === '/오늘일정') {
          if (!user) {
            await sendTelegramMessage(chatId, `⚠️ 먼저 계정 연동을 완료해 주세요.\n웹 대시보드에서 코드를 발급받은 뒤 /link [코드] 를 입력하세요.`);
            continue;
          }

          const todayPrefix = getKoreanDateString(0);
          const todaySchedules = db.prepare(`
            SELECT * FROM schedules 
            WHERE user_id = ? AND due_datetime LIKE ?
            ORDER BY due_datetime ASC
          `).all(user.id, `${todayPrefix}%`);

          if (todaySchedules.length === 0) {
            await sendTelegramMessage(chatId, `📅 오늘(${todayPrefix}) 예정된 일정이 없습니다. 편안하고 생산적인 하루 보내세요! ✨`, user.id, 'SCHEDULE_ALERT');
          } else {
            let reply = `📅 [${user.name}님의 오늘 일정 브리핑 (${todayPrefix})]\n총 ${todaySchedules.length}개의 일정이 있습니다.\n----------------------------\n`;
            for (const s of todaySchedules) {
              const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(s.id);
              reply += `\n[ID: ${s.id}] ${s.status === 'DONE' ? '✅' : '⏳'} ${s.title} (${s.due_datetime.split(' ')[1] || s.due_datetime})\n카테고리: ${s.category}`;
              if (s.description) {
                reply += `\n메모: ${s.description}`;
              }
              if (subtasks.length > 0) {
                const doneCount = subtasks.filter(st => st.is_done === 1).length;
                reply += `\n체크리스트 (${doneCount}/${subtasks.length}): ` + subtasks.map(st => `${st.is_done ? '☑' : '☐'} ${st.title}`).join(', ');
              }
              reply += `\n`;
            }
            reply += `\n💡 완료 처리: /완료 [ID]`;
            await sendTelegramMessage(chatId, reply, user.id, 'SCHEDULE_ALERT');
          }
          continue;
        }

        // 3. /완료 [일정ID]
        if (text.startsWith('/완료')) {
          if (!user) {
            await sendTelegramMessage(chatId, `⚠️ 먼저 계정 연동을 완료해 주세요.`);
            continue;
          }

          const parts = text.split(/\s+/);
          const scheduleId = parseInt(parts[1], 10);
          if (isNaN(scheduleId)) {
            await sendTelegramMessage(chatId, `⚠️ 올바른 일정 ID를 입력해 주세요.\n예: /완료 1`);
            continue;
          }

          const sched = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, user.id);
          if (!sched) {
            await sendTelegramMessage(chatId, `❌ ID ${scheduleId} 일정을 찾을 수 없거나 회원님의 일정이 아닙니다.`);
            continue;
          }

          db.prepare(`UPDATE schedules SET status = 'DONE' WHERE id = ?`).run(scheduleId);
          await sendTelegramMessage(chatId, `🎉 축하합니다!\n"[${sched.title}]" 일정을 완료(DONE) 처리했습니다. 수고하셨습니다! ⭐`, user.id, 'SCHEDULE_ALERT');
          continue;
        }

        // 4. Default Help
        if (text.startsWith('/help') || text.startsWith('/도움말')) {
          await sendTelegramMessage(chatId, `🤖 [WorkSmarter 스마트 비서 명령어 안내]\n\n• /link [연동코드] : 웹 계정과 1:1 연결\n• /오늘일정 : 오늘 등록된 모든 일정 및 세부 진행상황 확인\n• /완료 [일정ID] : 지정한 일정 즉시 완료 처리\n• /도움말 : 이 안내 메시지 출력`);
          continue;
        }
      }
    }
  } catch (err) {
    // Silently continue polling
  } finally {
    isPolling = false;
  }
}

// Start Polling every 3 seconds
setInterval(pollTelegramBot, 3000);

// ==========================================
// 4. Gemini API Integration & AI Helpers
// ==========================================

async function callGemini(prompt, isJson = false) {
  const apiKey = getSetting('gemini_api_key');
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    const config = isJson ? { responseMimeType: 'application/json' } : {};
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: config
    });
    return res && res.text ? res.text : null;
  } catch (err) {
    console.error('Gemini API 호출 오류 (규칙 기반 폴백으로 대체):', err.message);
    return null;
  }
}

// Fallback Subtasks Generator
function ruleBasedSplitSubtasks(title, description = '') {
  return [
    `${title} 관련 요구사항 및 핵심 자료 준비`,
    `${title} 1차 초안 작성 및 메인 실행 작업`,
    `${title} 중간 점검, 수정 및 누락 사항 보완`,
    `${title} 최종 검토 및 마무리 정리`
  ];
}

// ==========================================
// 5. Node-Cron Scheduled Alerts (1분 주기)
// ==========================================
cron.schedule('* * * * *', async () => {
  const botEnabled = getSetting('bot_enabled') === 'true';
  const token = getSetting('telegram_bot_token');
  if (!botEnabled || !token) return;

  const currentKST = getKoreanTimeString(0);

  try {
    const dueSchedules = db.prepare(`
      SELECT s.*, u.telegram_chat_id, u.name as user_name
      FROM schedules s
      JOIN users u ON s.user_id = u.id
      WHERE s.due_datetime = ? 
        AND s.is_important = 1 
        AND s.is_notified = 0 
        AND u.telegram_chat_id IS NOT NULL
    `).all(currentKST);

    for (const schedule of dueSchedules) {
      const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(schedule.id);
      const briefing = formatScheduleBriefing(schedule, subtasks);

      const ok = await sendTelegramMessage(schedule.telegram_chat_id, briefing, schedule.user_id, 'SCHEDULE_ALERT');
      if (ok) {
        db.prepare(`UPDATE schedules SET is_notified = 1 WHERE id = ?`).run(schedule.id);
      }
    }
  } catch (err) {
    console.error('스케줄러 알림 실행 중 에러:', err.message);
  }
});

// ==========================================
// 6. Authentication Middlewares
// ==========================================
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.session.errorMsg = '로그인이 필요한 서비스입니다.';
  return res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'ADMIN') {
    return next();
  }
  req.session.errorMsg = '관리자 권한이 필요합니다.';
  return res.redirect('/');
}

// ==========================================
// User Schedule Statistics Helper (stastics.md)
// ==========================================
function getUserScheduleStats(userId) {
  const schedules = db.prepare(`SELECT * FROM schedules WHERE user_id = ?`).all(userId);
  const totalCount = schedules.length;
  const todoCount = schedules.filter(s => s.status === 'TODO').length;
  const inProgressCount = schedules.filter(s => s.status === 'IN_PROGRESS').length;
  const doneCount = schedules.filter(s => s.status === 'DONE').length;
  const totalFocusMinutes = schedules.reduce((acc, s) => acc + (s.focus_minutes || 0), 0);
  const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const categories = ['업무', '개인', '팀프로젝트', '자기계발'];
  const categoryStats = {};
  categories.forEach(cat => {
    categoryStats[cat] = schedules.filter(s => s.category === cat).length;
  });

  return {
    totalCount,
    todoCount,
    inProgressCount,
    doneCount,
    completionRate,
    totalFocusMinutes,
    categoryStats
  };
}

// ==========================================
// 7. Authentication Routes
// ==========================================
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect(req.session.role === 'ADMIN' ? '/admin' : '/');
  }
  res.render('login');
});

app.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.session.errorMsg = '아이디와 비밀번호를 모두 입력해 주세요.';
    return res.redirect('/login');
  }

  const user = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    req.session.errorMsg = '아이디 또는 비밀번호가 일치하지 않습니다.';
    return res.redirect('/login');
  }

  // Set session
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.name = user.name;
  req.session.role = user.role;

  if (user.role === 'ADMIN') {
    return res.redirect('/admin');
  }
  return res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register');
});

app.post('/register', authLimiter, (req, res) => {
  const { username, password, password_confirm, name } = req.body;
  if (!username || !password || !name) {
    req.session.errorMsg = '모든 필드를 입력해 주세요.';
    return res.redirect('/register');
  }
  if (password !== password_confirm) {
    req.session.errorMsg = '비밀번호 확인이 일치하지 않습니다.';
    return res.redirect('/register');
  }

  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username.trim());
  if (existing) {
    req.session.errorMsg = '이미 존재하는 사용자 아이디입니다.';
    return res.redirect('/register');
  }

  const hash = bcrypt.hashSync(password, 10);
  const linkCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  db.prepare(`
    INSERT INTO users (username, password, name, role, telegram_link_code)
    VALUES (?, ?, ?, 'USER', ?)
  `).run(username.trim(), hash, name.trim(), linkCode);

  req.session.successMsg = '회원가입이 완료되었습니다. 로그인해 주세요!';
  return res.redirect('/login');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ==========================================
// 8. Main Dashboard & Schedule Routes
// ==========================================

app.get('/', isAuthenticated, (req, res) => {
  const userId = req.session.userId;

  // 1. Fetch user info
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

  // 2. Fetch user notes for schedule linking
  const userNotes = db.prepare(`
    SELECT id, title, linked_type, linked_schedule_id 
    FROM user_notes 
    WHERE user_id = ?
  `).all(userId);

  // 3. Fetch all schedules
  const rawSchedules = db.prepare(`
    SELECT * FROM schedules 
    WHERE user_id = ? 
    ORDER BY due_datetime IS NULL ASC, due_datetime ASC
  `).all(userId);

  // Attach subtasks, percent, and linked_notes to each schedule
  const schedules = rawSchedules.map(sched => {
    const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(sched.id);
    const total = subtasks.length;
    const completed = subtasks.filter(st => st.is_done === 1).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : (sched.status === 'DONE' ? 100 : 0);
    const linked_notes = userNotes.filter(n => n.linked_type === 'PERSONAL' && n.linked_schedule_id === sched.id);
    return {
      ...sched,
      subtasks,
      percent,
      total_subtasks: total,
      completed_subtasks: completed,
      linked_notes
    };
  });

  // Top 3 Priority Schedules: 개인 Top 3 + 소속 팀 Top 3 통합 조회
  const personalTop3 = schedules.filter(s => s.is_top3 === 1).map(s => ({
    ...s,
    itemType: 'PERSONAL'
  }));

  const teamTop3 = db.prepare(`
    SELECT ts.*, t.name as team_name, u.name as author_name, 'TEAM' as itemType,
           ut.created_at as top3_created_at
    FROM user_top3_team_schedules ut
    JOIN team_schedules ts ON ts.id = ut.team_schedule_id
    JOIN teams t ON t.id = ts.team_id
    LEFT JOIN users u ON u.id = ts.author_id
    WHERE ut.user_id = ?
    ORDER BY ut.created_at ASC, ts.due_datetime IS NULL ASC, ts.due_datetime ASC
  `).all(userId).map(sched => {
    const linked_notes = userNotes.filter(n => n.linked_type === 'TEAM' && n.linked_schedule_id === sched.id);
    return {
      ...sched,
      subtasks: [],
      percent: sched.status === 'DONE' ? 100 : (sched.status === 'IN_PROGRESS' ? 50 : 0),
      total_subtasks: 0,
      completed_subtasks: 0,
      linked_notes
    };
  });

  const top3List = [...personalTop3, ...teamTop3].slice(0, 3);
  const top3Schedules = top3List;

  // Statistics
  const stats = getUserScheduleStats(userId);

  // Recent notification logs
  const notificationLogs = db.prepare(`
    SELECT * FROM notification_logs 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 6
  `).all(userId);

  // Telegram bot system enabled status
  const botEnabled = getSetting('bot_enabled') === 'true';

  // 6. Fetch user's teams for direct schedule creation
  const myTeams = db.prepare(`
    SELECT t.id, t.name, tm.position, tm.role, tm.sort_order
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?
    ORDER BY tm.sort_order ASC, tm.joined_at ASC
  `).all(userId);

  // 7. Fetch all team schedules for teams this user belongs to
  const teamSchedules = db.prepare(`
    SELECT ts.*, t.name as team_name, u.name as author_name, COALESCE(tm.position, '팀원') as author_position, tm.role as author_role
    FROM team_schedules ts
    JOIN teams t ON t.id = ts.team_id
    JOIN users u ON u.id = ts.author_id
    LEFT JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ts.author_id
    WHERE ts.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
    ORDER BY ts.due_datetime IS NULL ASC, ts.due_datetime ASC
  `).all(userId).map(ts => ({
    ...ts,
    linked_notes: userNotes.filter(n => n.linked_type === 'TEAM' && n.linked_schedule_id === ts.id)
  }));

  // 8. Fetch user's custom widgets (moduleplus.md)
  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);

  res.render('index', {
    user,
    schedules,
    top3Schedules,
    top3List,
    stats,
    botEnabled,
    notificationLogs,
    myTeams,
    teamSchedules,
    activeMenu: 'dashboard',
    currentKSTDate: getKoreanDateString(0),
    customWidgets,
    dashboardLayout: getEffectiveDashboardLayout(user.dashboard_layout, customWidgets),
    widgetSpecs: WIDGET_SPECS,
    buildCustomWidgetSrcdoc
  });
});

// Create Schedule (Standard or Team Direct)
app.post('/schedules', isAuthenticated, (req, res) => {
  const { title, description, due_datetime, category, is_top3, is_important, target_workspace, no_deadline } = req.body;
  const userId = req.session.userId;

  if (!title || !title.trim()) {
    req.session.errorMsg = '일정 제목은 필수입니다.';
    return res.redirect('/');
  }

  // Format datetime: ensure YYYY-MM-DD HH:mm or NULL if no deadline
  const isNoDeadline = (no_deadline === 'on' || no_deadline === 'true' || no_deadline === true || !due_datetime || !due_datetime.trim());
  const formattedDateTime = isNoDeadline ? null : due_datetime.replace('T', ' ').slice(0, 16);

  // Check if target is a team workspace
  if (target_workspace && target_workspace !== 'personal') {
    const rawTeamId = target_workspace.startsWith('team_') ? target_workspace.replace('team_', '') : target_workspace;
    const teamId = parseInt(rawTeamId, 10);

    if (teamId) {
      // Verify user is a member of this team
      const membership = db.prepare(`
        SELECT * FROM team_members 
        WHERE team_id = ? AND user_id = ?
      `).get(teamId, userId);

      if (!membership) {
        req.session.errorMsg = '해당 팀에 일정을 등록할 권한이 없거나 가입되어 있지 않습니다.';
        return res.redirect('/');
      }

      const insertResult = db.prepare(`
        INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
        VALUES (?, ?, ?, ?, ?, 'TODO')
      `).run(
        teamId,
        userId,
        title.trim(),
        (description || '').trim(),
        formattedDateTime
      );

      // Audit Log
      logTeamScheduleAction(teamId, insertResult.lastInsertRowid, title.trim(), userId, 'CREATED', '대시보드에서 직접 등록');

      req.session.successMsg = '팀 일정으로 등록되었습니다.';
      return res.redirect('/');
    }
  }

  // Otherwise, insert into personal schedules
  db.prepare(`
    INSERT INTO schedules (user_id, title, description, due_datetime, category, status, is_top3, is_important)
    VALUES (?, ?, ?, ?, ?, 'TODO', ?, ?)
  `).run(
    userId,
    title.trim(),
    (description || '').trim(),
    formattedDateTime,
    category || '개인',
    is_top3 ? 1 : 0,
    is_important ? 1 : 0
  );

  req.session.successMsg = '새 일정이 성공적으로 등록되었습니다.';
  res.redirect('/');
});

// Reschedule Schedule (Calendar Drag & Drop)
app.post('/schedules/:id/reschedule', isAuthenticated, (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;
  const { due_datetime } = req.body;

  if (!due_datetime) {
    return res.status(400).json({ error: '마감 일시가 필요합니다.' });
  }

  const sched = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
  if (!sched) {
    return res.status(404).json({ error: '해당 일정을 찾을 수 없거나 수정 권한이 없습니다.' });
  }

  const formattedDateTime = due_datetime.replace('T', ' ').slice(0, 16);
  db.prepare(`UPDATE schedules SET due_datetime = ? WHERE id = ? AND user_id = ?`).run(formattedDateTime, scheduleId, userId);

  return res.json({
    success: true,
    id: scheduleId,
    new_due_datetime: formattedDateTime,
    message: '일정 일시가 변경되었습니다.'
  });
});

// Share personal schedule to team
app.post('/schedules/:id/share-to-team', isAuthenticated, (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;
  const teamId = parseInt(req.body.team_id, 10);

  if (!teamId) {
    req.session.errorMsg = '공유할 팀을 선택해 주세요.';
    return res.redirect('/');
  }

  // 1. Verify personal schedule ownership
  const sched = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
  if (!sched) {
    req.session.errorMsg = '해당 개인 일정을 찾을 수 없거나 권한이 없습니다.';
    return res.redirect('/');
  }

  // 2. Verify user is member of target team
  const membership = db.prepare(`SELECT * FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!membership) {
    req.session.errorMsg = '해당 팀에 일정을 공유할 권한이 없습니다.';
    return res.redirect('/');
  }

  // 3. Copy to team_schedules
  const result = db.prepare(`
    INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
    VALUES (?, ?, ?, ?, ?, 'TODO')
  `).run(
    teamId,
    userId,
    sched.title,
    sched.description || '',
    sched.due_datetime
  );

  // 4. Audit Log
  logTeamScheduleAction(teamId, result.lastInsertRowid, sched.title, userId, 'CREATED', `개인 일정(#${scheduleId})에서 복사 공유됨`);

  req.session.successMsg = '선택한 팀으로 일정이 성공적으로 공유되었습니다.';
  return res.redirect('/');
});

// Bulk Update Schedule Status (TODO / IN_PROGRESS / DONE)
app.post('/schedules/bulk-status', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  let { ids, status } = req.body;

  if (!['TODO', 'IN_PROGRESS', 'DONE'].includes(status)) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(400).json({ error: '유효하지 않은 상태값입니다.' });
    }
    req.session.errorMsg = '유효하지 않은 상태값입니다.';
    return res.redirect('/');
  }

  if (typeof ids === 'string') {
    ids = ids.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(400).json({ error: '선택된 일정이 없습니다.' });
    }
    req.session.errorMsg = '선택된 일정이 없습니다.';
    return res.redirect('/');
  }

  const validIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  if (validIds.length === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(400).json({ error: '유효하지 않은 일정 ID입니다.' });
    }
    return res.redirect('/');
  }

  const placeholders = validIds.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE schedules 
    SET status = ? 
    WHERE user_id = ? AND id IN (${placeholders})
  `).run(status, userId, ...validIds);

  req.session.successMsg = `${result.changes}개의 일정이 [${status}] 상태로 변경되었습니다.`;
  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
    return res.json({ success: true, count: result.changes });
  }
  res.redirect('/');
});

// Bulk Delete Schedules
app.post('/schedules/bulk-delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  let { ids } = req.body;

  if (typeof ids === 'string') {
    ids = ids.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(400).json({ error: '선택된 일정이 없습니다.' });
    }
    req.session.errorMsg = '선택된 일정이 없습니다.';
    return res.redirect('/');
  }

  const validIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  if (validIds.length === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(400).json({ error: '유효하지 않은 일정 ID입니다.' });
    }
    return res.redirect('/');
  }

  const placeholders = validIds.map(() => '?').join(',');

  // Delete subtasks for these schedules to ensure clean cascade
  db.prepare(`
    DELETE FROM subtasks 
    WHERE schedule_id IN (
      SELECT id FROM schedules WHERE user_id = ? AND id IN (${placeholders})
    )
  `).run(userId, ...validIds);

  // Delete schedules (strictly with user_id to prevent IDOR)
  const result = db.prepare(`
    DELETE FROM schedules 
    WHERE user_id = ? AND id IN (${placeholders})
  `).run(userId, ...validIds);

  req.session.successMsg = `${result.changes}개의 일정이 일괄 삭제되었습니다.`;
  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
    return res.json({ success: true, count: result.changes });
  }
  res.redirect('/');
});

// Update Schedule
app.post('/schedules/:id/update', isAuthenticated, (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;
  const { title, description, due_datetime, category, is_top3, is_important, status, no_deadline } = req.body;

  const isNoDeadline = (no_deadline === 'on' || no_deadline === 'true' || no_deadline === true || !due_datetime || !due_datetime.trim());
  const formattedDateTime = isNoDeadline ? null : due_datetime.replace('T', ' ').slice(0, 16);

  let query = `
    UPDATE schedules 
    SET title = ?, description = ?, due_datetime = ?, category = ?, is_top3 = ?, is_important = ?
  `;
  const params = [
    (title || '').trim(),
    (description || '').trim(),
    formattedDateTime,
    category || '개인',
    is_top3 ? 1 : 0,
    is_important ? 1 : 0
  ];

  if (status && ['TODO', 'IN_PROGRESS', 'DONE'].includes(status)) {
    query += `, status = ?`;
    params.push(status);
  }

  query += ` WHERE id = ? AND user_id = ?`;
  params.push(scheduleId, userId);

  const result = db.prepare(query).run(...params);

  const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');
  if (isAsync) {
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '일정을 찾을 수 없거나 권한이 없습니다.' });
    }
    const updated = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
    const stats = getUserScheduleStats(userId);
    return res.json({ success: true, schedule: updated, stats });
  }

  if (result.changes === 0) {
    req.session.errorMsg = '일정을 찾을 수 없거나 권한이 없습니다.';
  } else {
    req.session.successMsg = '일정이 수정되었습니다.';
  }
  res.redirect('/');
});

// Update Schedule Status (TODO / IN_PROGRESS / DONE)
app.post('/schedules/:id/status', isAuthenticated, (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;
  const { status } = req.body;

  if (!['TODO', 'IN_PROGRESS', 'DONE'].includes(status)) {
    return res.status(400).json({ error: '유효하지 않은 상태값입니다.' });
  }

  const result = db.prepare(`
    UPDATE schedules SET status = ? WHERE id = ? AND user_id = ?
  `).run(status, scheduleId, userId);

  const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');
  if (isAsync) {
    const stats = getUserScheduleStats(userId);
    return res.json({ success: result.changes > 0, status, stats });
  }
  res.redirect('/');
});

// Toggle Top 3 Priority
app.post('/schedules/:id/top3', isAuthenticated, (req, res) => {
  const scheduleId = parseInt(req.params.id, 10);
  const userId = req.session.userId;

  const current = db.prepare(`SELECT is_top3 FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
  if (current && current.is_top3 === 0) {
    const personalCount = db.prepare(`SELECT COUNT(*) as count FROM schedules WHERE user_id = ? AND is_top3 = 1`).get(userId).count;
    const teamCount = db.prepare(`SELECT COUNT(*) as count FROM user_top3_team_schedules WHERE user_id = ?`).get(userId).count;
    if (personalCount + teamCount >= 3) {
      req.session.errorMsg = '오늘의 핵심 목표는 최대 3개까지만 지정할 수 있습니다.';
      return res.redirect('/');
    }
  }

  db.prepare(`
    UPDATE schedules 
    SET is_top3 = CASE WHEN is_top3 = 1 THEN 0 ELSE 1 END
    WHERE id = ? AND user_id = ?
  `).run(scheduleId, userId);

  res.redirect('/');
});

// POST /api/top3/add: 드래그 앤 드롭으로 Top 3 등록
app.post('/api/top3/add', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { type, id } = req.body;
  const targetId = parseInt(id, 10);

  if (!type || !targetId || isNaN(targetId)) {
    return res.status(400).json({ success: false, error: '유효한 일정 정보가 필요합니다.' });
  }

  // 현재 사용자의 전체 Top 3 개수 (개인 + 팀 합산) 조회
  const personalCount = db.prepare(`SELECT COUNT(*) as count FROM schedules WHERE user_id = ? AND is_top3 = 1`).get(userId).count;
  const teamCount = db.prepare(`SELECT COUNT(*) as count FROM user_top3_team_schedules WHERE user_id = ?`).get(userId).count;
  const totalTop3 = personalCount + teamCount;

  if (type === 'PERSONAL') {
    const sched = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(targetId, userId);
    if (!sched) {
      return res.status(404).json({ success: false, error: '해당 개인 일정을 찾을 수 없거나 권한이 없습니다.' });
    }
    if (sched.is_top3 === 1) {
      return res.json({ success: true, message: '이미 Top 3 핵심 목표로 등록되어 있습니다.' });
    }
    if (totalTop3 >= 3) {
      return res.status(400).json({ success: false, error: '오늘의 핵심 목표는 최대 3개까지만 지정할 수 있습니다.' });
    }
    db.prepare(`UPDATE schedules SET is_top3 = 1 WHERE id = ? AND user_id = ?`).run(targetId, userId);
    return res.json({ success: true, message: 'Top 3 핵심 목표로 등록되었습니다.' });

  } else if (type === 'TEAM') {
    // 소속 팀 일정 검증 (해당 팀의 멤버인지 확인)
    const sched = db.prepare(`
      SELECT ts.* FROM team_schedules ts
      JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ?
      WHERE ts.id = ?
    `).get(userId, targetId);

    if (!sched) {
      return res.status(404).json({ success: false, error: '소속 팀 일정을 찾을 수 없거나 접근 권한이 없습니다.' });
    }

    const alreadyInTop3 = db.prepare(`SELECT id FROM user_top3_team_schedules WHERE user_id = ? AND team_schedule_id = ?`).get(userId, targetId);
    if (alreadyInTop3) {
      return res.json({ success: true, message: '이미 Top 3 핵심 목표로 등록되어 있습니다.' });
    }
    if (totalTop3 >= 3) {
      return res.status(400).json({ success: false, error: '오늘의 핵심 목표는 최대 3개까지만 지정할 수 있습니다.' });
    }

    db.prepare(`INSERT INTO user_top3_team_schedules (user_id, team_schedule_id) VALUES (?, ?)`).run(userId, targetId);
    return res.json({ success: true, message: '소속 팀 일정이 Top 3 핵심 목표로 등록되었습니다.' });

  } else {
    return res.status(400).json({ success: false, error: '유효하지 않은 일정 타입입니다.' });
  }
});

// POST /api/top3/remove: 바깥 드래그 또는 버튼 클릭으로 Top 3 해제
app.post('/api/top3/remove', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { type, id } = req.body;
  const targetId = parseInt(id, 10);

  if (!type || !targetId || isNaN(targetId)) {
    return res.status(400).json({ success: false, error: '유효한 일정 정보가 필요합니다.' });
  }

  if (type === 'PERSONAL') {
    const result = db.prepare(`UPDATE schedules SET is_top3 = 0 WHERE id = ? AND user_id = ?`).run(targetId, userId);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: '해당 일정을 찾을 수 없거나 권한이 없습니다.' });
    }
    return res.json({ success: true, message: 'Top 3 목표에서 해제되었습니다.' });

  } else if (type === 'TEAM') {
    db.prepare(`DELETE FROM user_top3_team_schedules WHERE user_id = ? AND team_schedule_id = ?`).run(userId, targetId);
    return res.json({ success: true, message: 'Top 3 목표에서 해제되었습니다.' });

  } else {
    return res.status(400).json({ success: false, error: '유효하지 않은 일정 타입입니다.' });
  }
});

// ==========================================
// Dashboard Widgets & Layout APIs (modules.md)
// ==========================================

// POST /api/dashboard/widgets: 위젯 켜기/끄기 설정 및 기본 프리셋 리셋
app.post('/api/dashboard/widgets', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { reset, widgets } = req.body;
  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);

  if (reset) {
    db.prepare(`UPDATE users SET dashboard_layout = NULL WHERE id = ?`).run(userId);
    const resetLayout = getEffectiveDashboardLayout(null, customWidgets);
    return res.json({
      success: true,
      message: '기본 프리셋으로 초기화되었습니다.',
      layout: resetLayout
    });
  }

  const user = db.prepare(`SELECT dashboard_layout FROM users WHERE id = ?`).get(userId);
  const currentLayout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);

  // Compute maximum Y among enabled items to append new widgets at the bottom
  let maxY = 0;
  currentLayout.forEach(item => {
    if (item.enabled) {
      const bottom = (item.y || 0) + (item.h || 2);
      if (bottom > maxY) maxY = bottom;
    }
  });

  const updatedLayout = currentLayout.map(item => {
    const isEnabled = widgets && widgets[item.id] !== undefined ? Boolean(widgets[item.id]) : item.enabled;
    let x = item.x;
    let y = item.y;
    if (!item.enabled && isEnabled) {
      // Place newly enabled widget in empty space at bottom
      x = 0;
      y = maxY;
      maxY += item.h;
    }
    return {
      ...item,
      x,
      y,
      enabled: isEnabled
    };
  });

  db.prepare(`UPDATE users SET dashboard_layout = ? WHERE id = ?`).run(JSON.stringify(updatedLayout), userId);
  return res.json({
    success: true,
    message: '위젯 설정이 저장되었습니다.',
    layout: updatedLayout
  });
});

// POST /api/dashboard/layout: 그리드스택 드래그/리사이즈 좌표 자동 저장
app.post('/api/dashboard/layout', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { layout } = req.body;

  if (!Array.isArray(layout)) {
    return res.status(400).json({ success: false, message: '유효한 레이아웃 데이터가 아닙니다.' });
  }

  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);
  const user = db.prepare(`SELECT dashboard_layout FROM users WHERE id = ?`).get(userId);
  const currentLayout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);

  const updatedLayout = currentLayout.map(existing => {
    const changed = layout.find(l => l && l.id === existing.id);
    if (changed) {
      return {
        ...existing,
        x: typeof changed.x === 'number' ? Math.max(0, changed.x) : existing.x,
        y: typeof changed.y === 'number' ? Math.max(0, changed.y) : existing.y,
        w: typeof changed.w === 'number' ? Math.max(1, Math.min(12, changed.w)) : existing.w,
        h: typeof changed.h === 'number' ? Math.max(1, changed.h) : existing.h,
        enabled: changed.enabled !== undefined ? Boolean(changed.enabled) : existing.enabled
      };
    }
    return existing;
  });

  db.prepare(`UPDATE users SET dashboard_layout = ? WHERE id = ?`).run(JSON.stringify(updatedLayout), userId);
  return res.json({ success: true, message: '레이아웃이 저장되었습니다.' });
});

// POST /api/dashboard/memo: 빠른 메모장 위젯 디바운스 자동 저장
app.post('/api/dashboard/memo', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const memo = typeof req.body.memo === 'string' ? req.body.memo : '';

  db.prepare(`UPDATE users SET quick_memo = ? WHERE id = ?`).run(memo, userId);
  return res.json({ success: true, message: '메모가 저장되었습니다.' });
});

// ==========================================
// Custom Widget Builder & Market APIs (moduleplus.md)
// ==========================================

// POST /api/custom-widgets: 새 커스텀 위젯 생성
app.post('/api/custom-widgets', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { title, description, html_code, css_code, js_code, default_w, default_h } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, message: '위젯 제목을 입력해 주세요.' });
  }

  const w = Math.max(1, Math.min(12, parseInt(default_w, 10) || 4));
  const h = Math.max(1, Math.min(20, parseInt(default_h, 10) || 3));

  const info = db.prepare(`
    INSERT INTO user_custom_widgets (user_id, title, description, html_code, css_code, js_code, default_w, default_h)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    title.trim(),
    (description || '').trim(),
    html_code || '',
    css_code || '',
    js_code || '',
    w,
    h
  );

  const newWidget = db.prepare(`SELECT * FROM user_custom_widgets WHERE id = ?`).get(info.lastInsertRowid);

  // Automatically add into dashboard_layout as enabled
  const user = db.prepare(`SELECT dashboard_layout FROM users WHERE id = ?`).get(userId);
  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);
  const layout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);
  db.prepare(`UPDATE users SET dashboard_layout = ? WHERE id = ?`).run(JSON.stringify(layout), userId);

  return res.json({ success: true, message: '커스텀 위젯이 성공적으로 생성되었습니다.', widget: newWidget });
});

// POST /api/custom-widgets/:id/update: 기존 커스텀 위젯 수정 (소유권 검증)
app.post('/api/custom-widgets/:id/update', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const widgetId = req.params.id;
  const { title, description, html_code, css_code, js_code, default_w, default_h } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, message: '위젯 제목을 입력해 주세요.' });
  }

  const existing = db.prepare(`SELECT * FROM user_custom_widgets WHERE id = ? AND user_id = ?`).get(widgetId, userId);
  if (!existing) {
    return res.status(404).json({ success: false, message: '위젯을 찾을 수 없거나 권한이 없습니다.' });
  }

  const w = Math.max(1, Math.min(12, parseInt(default_w, 10) || existing.default_w || 4));
  const h = Math.max(1, Math.min(20, parseInt(default_h, 10) || existing.default_h || 3));

  db.prepare(`
    UPDATE user_custom_widgets
    SET title = ?, description = ?, html_code = ?, css_code = ?, js_code = ?, default_w = ?, default_h = ?
    WHERE id = ? AND user_id = ?
  `).run(
    title.trim(),
    (description || '').trim(),
    html_code || '',
    css_code || '',
    js_code || '',
    w,
    h,
    widgetId,
    userId
  );

  const updatedWidget = db.prepare(`SELECT * FROM user_custom_widgets WHERE id = ?`).get(widgetId);
  return res.json({ success: true, message: '위젯이 성공적으로 수정되었습니다.', widget: updatedWidget });
});

// POST /api/custom-widgets/:id/delete: 커스텀 위젯 삭제 및 dashboard_layout에서 자동 제거
app.post('/api/custom-widgets/:id/delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const widgetId = req.params.id;

  const existing = db.prepare(`SELECT * FROM user_custom_widgets WHERE id = ? AND user_id = ?`).get(widgetId, userId);
  if (!existing) {
    return res.status(404).json({ success: false, message: '위젯을 찾을 수 없거나 권한이 없습니다.' });
  }

  db.prepare(`DELETE FROM user_custom_widgets WHERE id = ? AND user_id = ?`).run(widgetId, userId);

  // Automatically remove custom_{id} from dashboard_layout JSON
  const user = db.prepare(`SELECT dashboard_layout FROM users WHERE id = ?`).get(userId);
  if (user && user.dashboard_layout) {
    try {
      const parsed = JSON.parse(user.dashboard_layout);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(item => item && item.id !== `custom_${widgetId}`);
        db.prepare(`UPDATE users SET dashboard_layout = ? WHERE id = ?`).run(JSON.stringify(filtered), userId);
      }
    } catch (e) {}
  }

  return res.json({ success: true, message: '위젯이 삭제되었습니다.' });
});

// GET /api/custom-widgets/:id/export: 공유 가능한 표준 JSON 포맷 반환
app.get('/api/custom-widgets/:id/export', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const widgetId = req.params.id;

  const widget = db.prepare(`SELECT * FROM user_custom_widgets WHERE id = ? AND user_id = ?`).get(widgetId, userId);
  if (!widget) {
    return res.status(404).json({ success: false, message: '위젯을 찾을 수 없거나 권한이 없습니다.' });
  }

  const exportData = {
    format: "WorkSmarter-Widget-v1",
    title: widget.title,
    description: widget.description || '',
    html_code: widget.html_code || '',
    css_code: widget.css_code || '',
    js_code: widget.js_code || '',
    default_w: widget.default_w || 4,
    default_h: widget.default_h || 3
  };

  return res.json(exportData);
});

// POST /api/custom-widgets/import: 전달받은 JSON 문자열 검증 및 복제 등록 (크기 50KB 이하)
app.post('/api/custom-widgets/import', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const rawInput = req.body.widget_json || req.body.json_code || req.body;

  const strForCheck = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
  if (Buffer.byteLength(strForCheck, 'utf8') > 50 * 1024) {
    return res.status(400).json({ success: false, message: '위젯 JSON 크기는 50KB 이하여야 합니다.' });
  }

  let data;
  if (typeof rawInput === 'string') {
    try {
      data = JSON.parse(rawInput);
    } catch (e) {
      return res.status(400).json({ success: false, message: '올바른 JSON 형식이 아닙니다.' });
    }
  } else {
    data = rawInput;
  }

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ success: false, message: '유효한 위젯 데이터가 아닙니다.' });
  }

  if (data.format !== 'WorkSmarter-Widget-v1') {
    return res.status(400).json({ success: false, message: '지원하지 않는 위젯 포맷입니다. (WorkSmarter-Widget-v1 필요)' });
  }

  if (!data.title || typeof data.title !== 'string' || !data.title.trim()) {
    return res.status(400).json({ success: false, message: '위젯 제목이 누락되었습니다.' });
  }

  const title = data.title.trim();
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const html_code = typeof data.html_code === 'string' ? data.html_code : '';
  const css_code = typeof data.css_code === 'string' ? data.css_code : '';
  const js_code = typeof data.js_code === 'string' ? data.js_code : '';
  const default_w = Math.max(1, Math.min(12, parseInt(data.default_w, 10) || 4));
  const default_h = Math.max(1, Math.min(20, parseInt(data.default_h, 10) || 3));

  const info = db.prepare(`
    INSERT INTO user_custom_widgets (user_id, title, description, html_code, css_code, js_code, default_w, default_h)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    title,
    description,
    html_code,
    css_code,
    js_code,
    default_w,
    default_h
  );

  const newWidget = db.prepare(`SELECT * FROM user_custom_widgets WHERE id = ?`).get(info.lastInsertRowid);

  // Add into dashboard_layout as enabled
  const user = db.prepare(`SELECT dashboard_layout FROM users WHERE id = ?`).get(userId);
  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);
  const layout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);
  db.prepare(`UPDATE users SET dashboard_layout = ? WHERE id = ?`).run(JSON.stringify(layout), userId);

  return res.json({ success: true, message: '위젯을 성공적으로 가져왔습니다.', widget: newWidget });
});

// POST /api/custom-widgets/:id/toggle: 커스텀 위젯 대시보드 표시 토글
app.post('/api/custom-widgets/:id/toggle', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const widgetId = req.params.id;
  const enabled = Boolean(req.body.enabled);

  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);
  const user = db.prepare(`SELECT dashboard_layout FROM users WHERE id = ?`).get(userId);
  const layout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);

  const targetId = `custom_${widgetId}`;
  let found = false;
  layout.forEach(item => {
    if (item.id === targetId) {
      item.enabled = enabled;
      found = true;
    }
  });

  if (!found) {
    const cw = customWidgets.find(w => String(w.id) === String(widgetId));
    if (cw) {
      layout.push({
        id: targetId,
        x: 0,
        y: 99,
        w: cw.default_w || 4,
        h: cw.default_h || 3,
        enabled
      });
    }
  }

  db.prepare(`UPDATE users SET dashboard_layout = ? WHERE id = ?`).run(JSON.stringify(layout), userId);
  return res.json({ success: true, message: '위젯 표시 상태가 변경되었습니다.', enabled });
});

// Delete Schedule
app.post('/schedules/:id/delete', isAuthenticated, (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;

  db.prepare(`DELETE FROM schedules WHERE id = ? AND user_id = ?`).run(scheduleId, userId);
  req.session.successMsg = '일정이 삭제되었습니다.';
  res.redirect('/');
});

// Add Subtask Manually (checklist.md)
app.post('/schedules/:id/subtasks', isAuthenticated, (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;
  const { title } = req.body;

  const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');

  if (!title || title.trim() === '') {
    if (isAsync) return res.status(400).json({ success: false, error: '내용을 입력하세요.' });
    return res.redirect('/');
  }

  // Verify schedule ownership
  const sched = db.prepare(`SELECT id FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
  if (!sched) {
    if (isAsync) return res.status(403).json({ success: false, error: '권한이 없습니다.' });
    req.session.errorMsg = '권한이 없습니다.';
    return res.redirect('/');
  }

  const result = db.prepare(`INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, 0)`).run(scheduleId, title.trim());
  const newSubtask = db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(result.lastInsertRowid);

  const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(scheduleId);
  const total = subtasks.length;
  const completed = subtasks.filter(st => st.is_done === 1).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (isAsync) {
    return res.json({
      success: true,
      subtask: newSubtask,
      schedule_id: parseInt(scheduleId, 10),
      totalSubtasks: total,
      completedSubtasks: completed,
      progressPercent: percent
    });
  }

  res.redirect('/');
});

// Split Schedule into Subtasks with Gemini AI
app.post('/schedules/:id/subtasks/ai-split', isAuthenticated, async (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;

  const sched = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
  if (!sched) {
    req.session.errorMsg = '일정을 찾을 수 없습니다.';
    return res.redirect('/');
  }

  let steps = null;
  const prompt = `당신은 생산성 전문가입니다. 다음 일정을 바로 실행에 옮길 수 있도록 3~5개의 구체적인 하위 실행 단계(체크리스트)로 세분화해 주세요.
반드시 문자열 배열 형태의 JSON으로만 응답하세요. 예: ["1단계 작업 내용", "2단계 작업 내용", "3단계 작업 내용"]

일정 제목: ${sched.title}
세부 메모: ${sched.description || '없음'}
카테고리: ${sched.category}`;

  try {
    const rawResult = await callGemini(prompt, true);
    if (rawResult) {
      const parsed = JSON.parse(rawResult);
      if (Array.isArray(parsed) && parsed.length > 0) {
        steps = parsed;
      }
    }
  } catch (err) {
    console.error('Gemini 하위 작업 분할 실패, 규칙 기반 폴백 적용:', err.message);
  }

  if (!steps) {
    steps = ruleBasedSplitSubtasks(sched.title, sched.description);
  }

  const insertSub = db.prepare(`INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, 0)`);
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertSub.run(scheduleId, String(item));
    }
  });
  insertMany(steps);

  req.session.successMsg = `AI가 "${sched.title}"의 실행 단계 ${steps.length}개를 자동 분할하여 등록했습니다!`;
  res.redirect('/');
});

// Toggle Subtask (checklist.md)
app.post('/subtasks/:id/toggle', isAuthenticated, (req, res) => {
  const subtaskId = req.params.id;
  const userId = req.session.userId;

  const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');

  // Ownership verification via JOIN (IDOR Defense)
  const row = db.prepare(`
    SELECT subtasks.id, subtasks.is_done, schedules.id as schedule_id
    FROM subtasks
    JOIN schedules ON schedules.id = subtasks.schedule_id
    WHERE subtasks.id = ? AND schedules.user_id = ?
  `).get(subtaskId, userId);

  if (!row) {
    if (isAsync) {
      return res.status(403).json({ success: false, error: '권한이 없습니다.' });
    }
    return res.redirect('/');
  }

  const newStatus = row.is_done === 1 ? 0 : 1;
  db.prepare(`UPDATE subtasks SET is_done = ? WHERE id = ?`).run(newStatus, subtaskId);

  const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(row.schedule_id);
  const total = subtasks.length;
  const completed = subtasks.filter(st => st.is_done === 1).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (isAsync) {
    return res.json({
      success: true,
      is_done: newStatus,
      schedule_id: row.schedule_id,
      subtaskId: parseInt(subtaskId, 10),
      totalSubtasks: total,
      completedSubtasks: completed,
      progressPercent: percent
    });
  }
  res.redirect('/');
});

// Delete Subtask (checklist.md)
app.post('/subtasks/:id/delete', isAuthenticated, (req, res) => {
  const subtaskId = req.params.id;
  const userId = req.session.userId;

  const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');

  // Ownership verification via JOIN (IDOR Defense)
  const row = db.prepare(`
    SELECT subtasks.id, schedules.id as schedule_id
    FROM subtasks
    JOIN schedules ON schedules.id = subtasks.schedule_id
    WHERE subtasks.id = ? AND schedules.user_id = ?
  `).get(subtaskId, userId);

  if (!row) {
    if (isAsync) {
      return res.status(403).json({ success: false, error: '권한이 없습니다.' });
    }
    return res.redirect('/');
  }

  db.prepare(`DELETE FROM subtasks WHERE id = ?`).run(subtaskId);

  const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(row.schedule_id);
  const total = subtasks.length;
  const completed = subtasks.filter(st => st.is_done === 1).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (isAsync) {
    return res.json({
      success: true,
      schedule_id: row.schedule_id,
      subtaskId: parseInt(subtaskId, 10),
      totalSubtasks: total,
      completedSubtasks: completed,
      progressPercent: percent
    });
  }
  res.redirect('/');
});

// Focus Complete (Pomodoro Recording & Telegram Notification)
app.post('/schedules/:id/focus', isAuthenticated, async (req, res) => {
  const scheduleId = req.params.id;
  const userId = req.session.userId;
  const minutes = parseInt(req.body.minutes, 10) || 25;

  const sched = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(scheduleId, userId);
  if (!sched) {
    return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  }

  // Update focus minutes
  db.prepare(`UPDATE schedules SET focus_minutes = focus_minutes + ? WHERE id = ?`).run(minutes, scheduleId);

  // Send Telegram focus completion notification if user has linked Telegram
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (user && user.telegram_chat_id) {
    const focusMsg = `🎯 [집중 완료 알림]\n"${sched.title}" 일정에 ${minutes}분간 완전히 몰입하셨습니다!\n오늘도 멋진 생산성을 달성하셨네요. 잠시 스트레칭을 하며 휴식하세요. ☕`;
    await sendTelegramMessage(user.telegram_chat_id, focusMsg, userId, 'FOCUS_COMPLETE');
  }

  return res.json({
    success: true,
    added_minutes: minutes,
    total_focus: sched.focus_minutes + minutes
  });
});

// Complete Focus Session without linked schedule (General Session)
app.post('/focus/complete', isAuthenticated, async (req, res) => {
  const userId = req.session.userId;
  const minutes = parseInt(req.body.minutes, 10) || 25;
  const title = (req.body.title || '일반 집중 세션').trim();

  // Send Telegram focus completion notification if user has linked Telegram
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (user && user.telegram_chat_id) {
    const focusMsg = `🎯 [집중 완료 알림]\n"${title}"에 ${minutes}분간 완전히 몰입하셨습니다!\n오늘도 멋진 생산성을 달성하셨네요. 잠시 스트레칭을 하며 휴식하세요. ☕`;
    await sendTelegramMessage(user.telegram_chat_id, focusMsg, userId, 'FOCUS_COMPLETE');
  }

  return res.json({
    success: true,
    added_minutes: minutes,
    title
  });
});

// ==========================================
// 9. Telegram Integration User Routes
// ==========================================

// Generate 6-digit Link Code
app.post('/telegram/generate-code', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  db.prepare(`UPDATE users SET telegram_link_code = ? WHERE id = ?`).run(newCode, userId);
  req.session.successMsg = `새 텔레그램 연동 코드가 발급되었습니다: ${newCode}`;
  res.redirect(req.headers.referer || '/');
});

// Immediate Test Rich Briefing
app.post('/telegram/test-alert', isAuthenticated, async (req, res) => {
  const userId = req.session.userId;
  const { schedule_id } = req.body;

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!user || !user.telegram_chat_id) {
    req.session.errorMsg = '먼저 텔레그램 연동을 완료해 주세요. (우측 패널 또는 마이페이지 참조)';
    return res.redirect(req.headers.referer || '/');
  }

  let schedule = null;
  if (schedule_id) {
    schedule = db.prepare(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`).get(schedule_id, userId);
  }
  if (!schedule) {
    // Find latest important schedule or any schedule
    schedule = db.prepare(`
      SELECT * FROM schedules 
      WHERE user_id = ? AND is_important = 1 
      ORDER BY due_datetime ASC 
      LIMIT 1
    `).get(userId);
  }
  if (!schedule) {
    schedule = db.prepare(`SELECT * FROM schedules WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(userId);
  }

  if (!schedule) {
    req.session.errorMsg = '브리핑을 테스트할 일정이 없습니다. 일정을 먼저 등록해 주세요.';
    return res.redirect(req.headers.referer || '/');
  }

  const subtasks = db.prepare(`SELECT * FROM subtasks WHERE schedule_id = ?`).all(schedule.id);
  const briefing = formatScheduleBriefing(schedule, subtasks);

  const ok = await sendTelegramMessage(user.telegram_chat_id, briefing, userId, 'TEST_ALERT');
  if (ok) {
    req.session.successMsg = `텔레그램으로 "[${schedule.title}]" 리치 브리핑 테스트를 발송했습니다!`;
  } else {
    req.session.errorMsg = '텔레그램 발송에 실패했습니다. 관리자 설정의 봇 토큰을 확인해 주세요.';
  }

  res.redirect(req.headers.referer || '/');
});

// ==========================================
// 9-1. Team Workspace Routes
// ==========================================

// Helper: 8-character random alphanumeric invite code generator
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/teams/recent-updates: 내가 속한 팀들의 다른 팀원 활동 최근 업데이트 조회
app.get('/api/teams/recent-updates', isAuthenticated, (req, res) => {
  const userId = req.session.userId;

  // 내가 속한 팀 ID 목록 조회
  const myTeamRows = db.prepare(`SELECT team_id FROM team_members WHERE user_id = ?`).all(userId);
  if (myTeamRows.length === 0) {
    return res.json({ latestId: null, updates: [] });
  }

  const teamIds = myTeamRows.map(r => r.team_id);
  const placeholders = teamIds.map(() => '?').join(',');

  // 1. 최근 등록된 팀 일정 (본인 제외)
  const schedUpdates = db.prepare(`
    SELECT 
      ts.id, 
      ts.team_id as teamId, 
      'SCHEDULE' as type, 
      t.name as teamName, 
      u.name as authorName, 
      COALESCE(tm.position, '팀원') as authorPosition, 
      ts.title, 
      ts.created_at as createdAt
    FROM team_schedules ts
    JOIN teams t ON t.id = ts.team_id
    JOIN users u ON u.id = ts.author_id
    LEFT JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ts.author_id
    WHERE ts.team_id IN (${placeholders})
      AND ts.author_id != ?
    ORDER BY ts.created_at DESC
    LIMIT 10
  `).all(...teamIds, userId);

  // 2. 최근 등록된 팀 특이사항/공지 (본인 제외)
  const noteUpdates = db.prepare(`
    SELECT 
      tn.id, 
      tn.team_id as teamId, 
      'NOTE' as type, 
      t.name as teamName, 
      u.name as authorName, 
      COALESCE(tm.position, '팀원') as authorPosition, 
      tn.title, 
      tn.created_at as createdAt
    FROM team_notes tn
    JOIN teams t ON t.id = tn.team_id
    JOIN users u ON u.id = tn.author_id
    LEFT JOIN team_members tm ON tm.team_id = tn.team_id AND tm.user_id = tn.author_id
    WHERE tn.team_id IN (${placeholders})
      AND tn.author_id != ?
    ORDER BY tn.created_at DESC
    LIMIT 10
  `).all(...teamIds, userId);

  // 병합 및 시간순 정렬 (최신순)
  const allUpdates = [...schedUpdates, ...noteUpdates].sort((a, b) => {
    return new Date(b.createdAt) - new Date(a.createdAt);
  }).slice(0, 10);

  const latestId = allUpdates.length > 0 ? `${allUpdates[0].type}_${allUpdates[0].id}_${allUpdates[0].createdAt}` : null;

  res.json({
    latestId,
    updates: allUpdates
  });
});

// GET /teams: 내가 속한 팀 목록 및 특정 팀 대시보드
app.get('/teams', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

  // 실시간 방어 로직: URL에 특정 팀이 지정된 경우 리더 부재 체크 및 자동 승급
  let teamId = req.query.teamId ? parseInt(req.query.teamId, 10) : null;
  if (teamId) {
    ensureTeamLeader(teamId);
  }

  // 1. 내가 속한 팀 목록 조회 (사용자별 sort_order 기준 정렬)
  let myTeams = db.prepare(`
    SELECT t.*, tm.position, tm.role, tm.sort_order,
           (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?
    ORDER BY tm.sort_order ASC, tm.joined_at ASC
  `).all(userId);

  if (!teamId && myTeams.length > 0) {
    teamId = myTeams[0].id;
    // 선택된 기본 팀에 대해 실시간 방어 로직 체크
    const promoted = ensureTeamLeader(teamId);
    if (promoted) {
      // 본인이 승급되어 position/role 등이 변경되었을 수 있으므로 myTeams 재조회
      myTeams = db.prepare(`
        SELECT t.*, tm.position, tm.role, tm.sort_order,
               (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
        FROM teams t
        JOIN team_members tm ON tm.team_id = t.id
        WHERE tm.user_id = ?
        ORDER BY tm.sort_order ASC, tm.joined_at ASC
      `).all(userId);
    }
  }

  let currentTeam = null;
  let myMembership = null;
  let members = [];
  let schedules = [];
  let notes = [];
  let scheduleLogs = [];

  if (teamId) {
    // 실시간 방어 로직 (이중 안전장치)
    ensureTeamLeader(teamId);

    // 요청 사용자가 해당 팀의 멤버인지 검증 (비멤버 차단)
    myMembership = db.prepare(`
      SELECT * FROM team_members 
      WHERE team_id = ? AND user_id = ?
    `).get(teamId, userId);

    if (!myMembership) {
      req.session.errorMsg = '해당 팀에 접근할 권한이 없거나 가입되어 있지 않습니다.';
      return res.redirect('/teams');
    }

    currentTeam = db.prepare(`
      SELECT t.*, COALESCE(u.name, '알 수 없음') as owner_name, COALESCE(u.username, '') as owner_username
      FROM teams t
      LEFT JOIN users u ON u.id = t.owner_id
      WHERE t.id = ?
    `).get(teamId);

    // 팀원 목록
    members = db.prepare(`
      SELECT tm.*, u.username, u.name
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY 
        CASE tm.role 
          WHEN 'LEADER' THEN 1 
          WHEN 'MANAGER' THEN 2 
          ELSE 3 
        END,
        tm.joined_at ASC
    `).all(teamId);

    // 팀 공유 일정
    const userNotes = db.prepare(`
      SELECT id, title, linked_type, linked_schedule_id 
      FROM user_notes 
      WHERE user_id = ?
    `).all(userId);

    schedules = db.prepare(`
      SELECT ts.*, u.name as author_name, tm.position as author_position, tm.role as author_role
      FROM team_schedules ts
      LEFT JOIN users u ON u.id = ts.author_id
      LEFT JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ts.author_id
      WHERE ts.team_id = ?
      ORDER BY ts.due_datetime IS NULL ASC, ts.due_datetime ASC
    `).all(teamId).map(sched => ({
      ...sched,
      linked_notes: userNotes.filter(n => n.linked_type === 'TEAM' && n.linked_schedule_id === sched.id)
    }));

    // 팀 특이사항 & 공유 메모
    notes = db.prepare(`
      SELECT tn.*, u.name as author_name, tm.position as author_position, tm.role as author_role
      FROM team_notes tn
      LEFT JOIN users u ON u.id = tn.author_id
      LEFT JOIN team_members tm ON tm.team_id = tn.team_id AND tm.user_id = tn.author_id
      WHERE tn.team_id = ?
      ORDER BY tn.is_pinned DESC, tn.created_at DESC
    `).all(teamId);

    // 팀 일정 수정/감사 로그 (LEADER 및 MANAGER 전용)
    if (myMembership && (myMembership.role === 'LEADER' || myMembership.role === 'MANAGER')) {
      scheduleLogs = db.prepare(`
        SELECT tsl.*, u.name as editor_name, COALESCE(tm.position, '팀원') as editor_position
        FROM team_schedule_logs tsl
        JOIN users u ON u.id = tsl.editor_id
        LEFT JOIN team_members tm ON tm.team_id = tsl.team_id AND tm.user_id = tsl.editor_id
        WHERE tsl.team_id = ?
        ORDER BY tsl.created_at DESC
        LIMIT 50
      `).all(teamId);
    }
  }

  res.render('teams', {
    user,
    myTeams,
    currentTeam,
    myMembership,
    members,
    schedules,
    notes,
    scheduleLogs,
    activeMenu: 'teams',
    currentKSTDate: getKoreanDateString(0)
  });
});

// POST /teams/create: 새 프로젝트 팀 생성
app.post('/teams/create', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    req.session.errorMsg = '팀명을 입력해 주세요.';
    return res.redirect('/teams');
  }

  // 중복되지 않는 초대 코드 생성
  let inviteCode = '';
  let isUnique = false;
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    inviteCode = generateInviteCode();
    const existing = db.prepare(`SELECT id FROM teams WHERE invite_code = ?`).get(inviteCode);
    if (!existing) isUnique = true;
    attempts++;
  }

  const teamStmt = db.prepare(`
    INSERT INTO teams (name, description, invite_code, owner_id)
    VALUES (?, ?, ?, ?)
  `);
  const result = teamStmt.run(name.trim(), description ? description.trim() : '', inviteCode, userId);
  const newTeamId = result.lastInsertRowid;

  // 생성자는 자동으로 position: '팀장', role: 'LEADER'로 등록
  db.prepare(`
    INSERT INTO team_members (team_id, user_id, position, role)
    VALUES (?, ?, '팀장', 'LEADER')
  `).run(newTeamId, userId);

  req.session.successMsg = `새 프로젝트 팀 "${name.trim()}"이(가) 성공적으로 생성되었습니다. (초대 코드: ${inviteCode})`;
  res.redirect(`/teams?teamId=${newTeamId}`);
});

// POST /teams/join: 초대 코드로 팀 참여
app.post('/teams/join', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { invite_code } = req.body;

  if (!invite_code || !invite_code.trim()) {
    req.session.errorMsg = '초대 코드를 입력해 주세요.';
    return res.redirect('/teams');
  }

  const code = invite_code.trim().toUpperCase();
  const team = db.prepare(`SELECT * FROM teams WHERE UPPER(invite_code) = ?`).get(code);

  if (!team) {
    req.session.errorMsg = '유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.';
    return res.redirect('/teams');
  }

  // 이미 가입된 팀인지 확인
  const existingMember = db.prepare(`
    SELECT id FROM team_members WHERE team_id = ? AND user_id = ?
  `).get(team.id, userId);

  if (existingMember) {
    req.session.errorMsg = `이미 "${team.name}" 팀에 가입되어 있습니다.`;
    return res.redirect(`/teams?teamId=${team.id}`);
  }

  // position: '팀원', role: 'MEMBER'로 등록
  db.prepare(`
    INSERT INTO team_members (team_id, user_id, position, role)
    VALUES (?, ?, '팀원', 'MEMBER')
  `).run(team.id, userId);

  req.session.successMsg = `"${team.name}" 팀에 성공적으로 참여하였습니다!`;
  res.redirect(`/teams?teamId=${team.id}`);
});

// POST /teams/:teamId/regenerate-code: 초대 코드 재발급 (LEADER 전용)
app.post('/teams/:teamId/regenerate-code', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!mem || mem.role !== 'LEADER') {
    req.session.errorMsg = '초대 코드 재발급 권한이 없습니다. (팀장 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  let inviteCode = '';
  let isUnique = false;
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    inviteCode = generateInviteCode();
    const existing = db.prepare(`SELECT id FROM teams WHERE invite_code = ?`).get(inviteCode);
    if (!existing) isUnique = true;
    attempts++;
  }

  db.prepare(`UPDATE teams SET invite_code = ? WHERE id = ?`).run(inviteCode, teamId);
  req.session.successMsg = `새 초대 코드가 발급되었습니다: ${inviteCode}`;
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/update: 팀 정보(이름, 설명) 수정 (LEADER 전용)
app.post('/teams/:teamId/update', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const { name, description } = req.body;

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!mem || mem.role !== 'LEADER') {
    req.session.errorMsg = '팀 정보 수정 권한이 없습니다. (팀장 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  if (!name || !name.trim()) {
    req.session.errorMsg = '팀명을 입력해 주세요.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  db.prepare(`UPDATE teams SET name = ?, description = ? WHERE id = ?`).run(name.trim(), (description || '').trim(), teamId);
  req.session.successMsg = '팀 정보가 성공적으로 수정되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/delete: 팀 영구 삭제 (LEADER 전용)
app.post('/teams/:teamId/delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!mem || mem.role !== 'LEADER') {
    req.session.errorMsg = '팀 삭제 권한이 없습니다. (팀장 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const deleteTx = db.transaction(() => {
    db.prepare(`DELETE FROM team_schedule_logs WHERE team_id = ?`).run(teamId);
    db.prepare(`DELETE FROM team_notes WHERE team_id = ?`).run(teamId);
    db.prepare(`DELETE FROM team_schedules WHERE team_id = ?`).run(teamId);
    db.prepare(`DELETE FROM team_members WHERE team_id = ?`).run(teamId);
    db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
  });

  try {
    deleteTx();
    req.session.successMsg = '팀이 성공적으로 삭제되었습니다.';
  } catch (err) {
    console.error('Failed to delete team:', err);
    req.session.errorMsg = '팀 삭제 중 오류가 발생했습니다.';
  }

  res.redirect('/teams');
});

// POST /teams/:teamId/members/:memberId/update: 팀원 직책 및 권한 수정 (LEADER 전용, 팀장 자가강등 및 LEADER 임명 차단)
app.post('/teams/:teamId/members/:memberId/update', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const memberId = parseInt(req.params.memberId, 10);
  const { position, role } = req.body;

  const myMem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!myMem || myMem.role !== 'LEADER') {
    req.session.errorMsg = '팀원 정보 수정 권한이 없습니다. (팀장 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const targetMem = db.prepare(`SELECT * FROM team_members WHERE id = ? AND team_id = ?`).get(memberId, teamId);
  if (!targetMem) {
    req.session.errorMsg = '해당 팀원을 찾을 수 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  // 대상 멤버가 현재 LEADER이거나 변경하려는 role이 LEADER인 경우 차단 (팀장 0명 방지 무결성)
  if (targetMem.role === 'LEADER' || role === 'LEADER') {
    req.session.errorMsg = '팀장 권한은 일반 권한 변경으로 수정할 수 없습니다. [팀장 위임] 기능을 이용해 주세요.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const validRole = ['MANAGER', 'MEMBER'].includes(role) ? role : 'MEMBER';
  const posText = (position && position.trim()) ? position.trim() : '팀원';

  db.prepare(`
    UPDATE team_members SET position = ?, role = ? 
    WHERE id = ? AND team_id = ?
  `).run(posText, validRole, memberId, teamId);

  req.session.successMsg = '팀원 직책 및 권한이 성공적으로 수정되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/transfer-leader: 팀장 권한 위임 (LEADER 전용, 트랜잭션 무결성 보장)
app.post('/teams/:teamId/transfer-leader', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const targetMemberId = parseInt(req.body.target_member_id, 10);

  const myMem = db.prepare(`SELECT * FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!myMem || myMem.role !== 'LEADER') {
    req.session.errorMsg = '팀장 권한 위임은 현재 팀장(LEADER)만 수행할 수 있습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const targetMem = db.prepare(`SELECT * FROM team_members WHERE id = ? AND team_id = ?`).get(targetMemberId, teamId);
  if (!targetMem || targetMem.user_id === userId) {
    req.session.errorMsg = '위임 대상 팀원이 올바르지 않습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const targetUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(targetMem.user_id);

  const transferTx = db.transaction(() => {
    // 1. 위임받는 팀원을 LEADER로 승격 (직책이 '팀원'이면 '팀장'으로 변경)
    const newPos = (targetMem.position === '팀원' || !targetMem.position) ? '팀장' : targetMem.position;
    db.prepare(`UPDATE team_members SET role = 'LEADER', position = ? WHERE id = ?`).run(newPos, targetMemberId);

    // 2. 기존 팀장(본인)을 MEMBER로 전환 (직책이 '팀장'이면 '팀원'으로 변경)
    const myNewPos = myMem.position === '팀장' ? '팀원' : myMem.position;
    db.prepare(`UPDATE team_members SET role = 'MEMBER', position = ? WHERE id = ?`).run(myNewPos, myMem.id);

    // 3. teams 테이블 owner_id를 새 팀장의 user_id로 업데이트
    db.prepare(`UPDATE teams SET owner_id = ? WHERE id = ?`).run(targetMem.user_id, teamId);
  });

  try {
    transferTx();
    req.session.successMsg = `${targetUser ? targetUser.name : '팀원'}님에게 팀장 권한이 성공적으로 위임되었습니다.`;
  } catch (err) {
    console.error('Failed to transfer leadership:', err);
    req.session.errorMsg = '팀장 권한 위임 처리 중 오류가 발생했습니다.';
  }

  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /api/teams/move: 화살표 버튼 기반 인접한 두 팀의 sort_order 맞바꾸기
app.post('/api/teams/move', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { teamId, direction, targetTeamId } = req.body;
  const tid = parseInt(teamId, 10);

  if (!tid || isNaN(tid)) {
    return res.status(400).json({ success: false, error: '유효한 팀 ID가 필요합니다.' });
  }

  // 사용자의 모든 팀 목록을 현재 정렬 순서대로 조회
  const userTeams = db.prepare(`
    SELECT tm.id as member_id, tm.team_id, tm.sort_order, tm.joined_at
    FROM team_members tm
    WHERE tm.user_id = ?
    ORDER BY tm.sort_order ASC, tm.joined_at ASC, tm.id ASC
  `).all(userId);

  const currentIndex = userTeams.findIndex(t => t.team_id === tid);
  if (currentIndex === -1) {
    return res.status(404).json({ success: false, error: '가입된 팀을 찾을 수 없습니다.' });
  }

  let targetIndex = -1;
  if (targetTeamId) {
    const ttid = parseInt(targetTeamId, 10);
    targetIndex = userTeams.findIndex(t => t.team_id === ttid);
  } else if (direction === 'left' || direction === 'prev' || direction === 'up') {
    targetIndex = currentIndex - 1;
  } else if (direction === 'right' || direction === 'next' || direction === 'down') {
    targetIndex = currentIndex + 1;
  }

  if (targetIndex < 0 || targetIndex >= userTeams.length) {
    return res.json({ success: true, message: '더 이상 이동할 수 없습니다.' });
  }

  // 인접한 두 팀의 위치 맞바꾸기 (swap)
  const temp = userTeams[currentIndex];
  userTeams[currentIndex] = userTeams[targetIndex];
  userTeams[targetIndex] = temp;

  // DB에 0, 1, 2... 순차적 sort_order 저장
  const updateStmt = db.prepare(`
    UPDATE team_members
    SET sort_order = ?
    WHERE user_id = ? AND team_id = ?
  `);

  const tx = db.transaction((teamsList) => {
    teamsList.forEach((t, idx) => {
      updateStmt.run(idx, userId, t.team_id);
    });
  });

  try {
    tx(userTeams);
    return res.json({ success: true, message: '팀 순서가 성공적으로 변경되었습니다.' });
  } catch (err) {
    console.error('Failed to move team order:', err);
    return res.status(500).json({ success: false, error: '팀 순서 변경 중 오류가 발생했습니다.' });
  }
});

// POST /api/teams/reorder: 팀 목록 사용자별 드래그 앤 드롭 순서 저장
app.post('/api/teams/reorder', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { order, teamIds } = req.body;
  const list = order || teamIds;

  if (!Array.isArray(list)) {
    return res.status(400).json({ error: '유효한 팀 순서 배열이 필요합니다.' });
  }

  const updateStmt = db.prepare(`
    UPDATE team_members 
    SET sort_order = ? 
    WHERE user_id = ? AND team_id = ?
  `);

  const tx = db.transaction((items) => {
    items.forEach((tid, idx) => {
      updateStmt.run(idx, userId, parseInt(tid, 10));
    });
  });

  try {
    tx(list);
    return res.json({ success: true, message: '팀 정렬 순서가 저장되었습니다.' });
  } catch (err) {
    console.error('Failed to save team sort order:', err);
    return res.status(500).json({ error: '순서 저장 중 오류가 발생했습니다.' });
  }
});

// POST /teams/:teamId/members/:memberId/remove: 팀원 추방 (LEADER 전용, 본인 추방 방지)
app.post('/teams/:teamId/members/:memberId/remove', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const memberId = parseInt(req.params.memberId, 10);

  const myMem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!myMem || myMem.role !== 'LEADER') {
    req.session.errorMsg = '팀원 내보내기 권한이 없습니다. (팀장 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const targetMem = db.prepare(`SELECT * FROM team_members WHERE id = ? AND team_id = ?`).get(memberId, teamId);
  if (!targetMem) {
    req.session.errorMsg = '해당 팀원을 찾을 수 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  if (targetMem.user_id === userId) {
    req.session.errorMsg = '팀장은 본인을 팀에서 내보낼 수 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  db.prepare(`DELETE FROM team_members WHERE id = ? AND team_id = ?`).run(memberId, teamId);
  req.session.successMsg = '해당 팀원을 팀에서 내보냈습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/schedules: 팀 공유 일정 등록 (LEADER / MANAGER)
app.post('/teams/:teamId/schedules', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const { title, description, due_datetime, no_deadline } = req.body;

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!mem) {
    req.session.errorMsg = '해당 팀의 팀원이 아닙니다.';
    return res.redirect('/teams');
  }

  if (mem.role !== 'LEADER' && mem.role !== 'MANAGER') {
    req.session.errorMsg = '팀 일정 등록 권한이 없습니다. (팀장/운영진 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  if (!title || !title.trim()) {
    req.session.errorMsg = '일정 제목을 입력해 주세요.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const isNoDeadline = (no_deadline === 'on' || no_deadline === 'true' || no_deadline === true || !due_datetime || !due_datetime.trim());
  const formattedDue = isNoDeadline ? null : due_datetime.replace('T', ' ').slice(0, 16);

  const insertResult = db.prepare(`
    INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
    VALUES (?, ?, ?, ?, ?, 'TODO')
  `).run(teamId, userId, title.trim(), description ? description.trim() : '', formattedDue);

  // Audit Log
  logTeamScheduleAction(teamId, insertResult.lastInsertRowid, title.trim(), userId, 'CREATED', '팀 일정 등록');

  req.session.successMsg = '새 팀 공유 일정이 등록되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/schedules/:id/update: 팀 일정 내용 수정 (작성자 본인 또는 LEADER / MANAGER)
app.post('/teams/:teamId/schedules/:id/update', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);
  const { title, description, due_datetime, status, no_deadline } = req.body;

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  const sched = db.prepare(`SELECT * FROM team_schedules WHERE id = ? AND team_id = ?`).get(id, teamId);

  if (!mem || !sched) {
    req.session.errorMsg = '수정할 일정이 없거나 권한이 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  // 작성자 본인이거나 LEADER / MANAGER인지 검증
  if (mem.role !== 'LEADER' && mem.role !== 'MANAGER' && sched.author_id !== userId) {
    req.session.errorMsg = '해당 팀 일정을 수정할 권한이 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  if (!title || !title.trim()) {
    req.session.errorMsg = '일정 제목을 입력해 주세요.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const validStatus = ['TODO', 'IN_PROGRESS', 'DONE'].includes(status) ? status : sched.status;
  const isNoDeadline = (no_deadline === 'on' || no_deadline === 'true' || no_deadline === true || !due_datetime || !due_datetime.trim());
  const formattedDue = isNoDeadline ? null : due_datetime.replace('T', ' ').slice(0, 16);

  db.prepare(`
    UPDATE team_schedules 
    SET title = ?, description = ?, due_datetime = ?, status = ?
    WHERE id = ? AND team_id = ?
  `).run(title.trim(), (description || '').trim(), formattedDue, validStatus, id, teamId);

  // Audit Log
  const changeDetail = `제목: "${sched.title}" -> "${title.trim()}", 마감: ${sched.due_datetime || '상시'} -> ${formattedDue || '상시'}, 상태: ${sched.status} -> ${validStatus}`;
  logTeamScheduleAction(teamId, id, title.trim(), userId, 'UPDATED', changeDetail);

  req.session.successMsg = '팀 일정이 수정되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/schedules/:id/status: 팀 일정 상태 변경 (팀원 누구나)
app.post('/teams/:teamId/schedules/:id/status', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;

  const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json');

  const mem = db.prepare(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  const sched = db.prepare(`SELECT * FROM team_schedules WHERE id = ? AND team_id = ?`).get(id, teamId);
  if (!mem || !sched) {
    if (isAsync) {
      return res.status(403).json({ success: false, error: '해당 팀의 팀원이 아니거나 일정을 찾을 수 없습니다.' });
    }
    req.session.errorMsg = '해당 팀의 팀원이 아니거나 일정을 찾을 수 없습니다.';
    return res.redirect('/teams');
  }

  const validStatus = ['TODO', 'IN_PROGRESS', 'DONE'].includes(status) ? status : 'TODO';

  db.prepare(`
    UPDATE team_schedules SET status = ? 
    WHERE id = ? AND team_id = ?
  `).run(validStatus, id, teamId);

  // Audit Log
  logTeamScheduleAction(teamId, id, sched.title, userId, 'STATUS_CHANGED', `상태 변경: ${sched.status} -> ${validStatus}`);

  if (isAsync) {
    return res.json({ success: true, status: validStatus });
  }

  req.session.successMsg = '팀 일정 상태가 변경되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/schedules/:id/delete: 팀 일정 삭제 (LEADER / MANAGER 또는 본인)
app.post('/teams/:teamId/schedules/:id/delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  const sched = db.prepare(`SELECT * FROM team_schedules WHERE id = ? AND team_id = ?`).get(id, teamId);

  if (!mem || !sched) {
    req.session.errorMsg = '삭제할 일정이 없거나 권한이 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  if (mem.role !== 'LEADER' && mem.role !== 'MANAGER' && sched.author_id !== userId) {
    req.session.errorMsg = '해당 팀 일정을 삭제할 권한이 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  db.prepare(`DELETE FROM team_schedules WHERE id = ? AND team_id = ?`).run(id, teamId);

  // Audit Log
  logTeamScheduleAction(teamId, id, sched.title, userId, 'DELETED', `팀 일정 "${sched.title}" 삭제됨`);

  req.session.successMsg = '팀 일정이 삭제되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/notes: 팀 특이사항/공지 등록 (팀원 누구나)
app.post('/teams/:teamId/notes', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const { category, title, content } = req.body;

  const mem = db.prepare(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!mem) {
    req.session.errorMsg = '해당 팀의 팀원이 아닙니다.';
    return res.redirect('/teams');
  }

  if (!title || !title.trim() || !content || !content.trim()) {
    req.session.errorMsg = '특이사항 제목과 내용을 모두 입력해 주세요.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  const validCategory = ['공지', '특이사항', '회의록', '이슈'].includes(category) ? category : '특이사항';

  db.prepare(`
    INSERT INTO team_notes (team_id, author_id, category, title, content, is_pinned)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(teamId, userId, validCategory, title.trim(), content.trim());

  req.session.successMsg = '특이사항 / 메모가 등록되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/notes/:id/pin: 특이사항 상단 고정 토글 (LEADER / MANAGER)
app.post('/teams/:teamId/notes/:id/pin', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  if (!mem || (mem.role !== 'LEADER' && mem.role !== 'MANAGER')) {
    req.session.errorMsg = '특이사항 상단 고정 권한이 없습니다. (팀장/운영진 전용)';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  db.prepare(`
    UPDATE team_notes 
    SET is_pinned = (CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END) 
    WHERE id = ? AND team_id = ?
  `).run(id, teamId);

  req.session.successMsg = '특이사항 고정 상태가 변경되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// POST /teams/:teamId/notes/:id/delete: 특이사항 삭제 (LEADER/MANAGER는 전체, MEMBER는 본인 글만)
app.post('/teams/:teamId/notes/:id/delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);

  const mem = db.prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`).get(teamId, userId);
  const note = db.prepare(`SELECT * FROM team_notes WHERE id = ? AND team_id = ?`).get(id, teamId);

  if (!mem || !note) {
    req.session.errorMsg = '삭제할 특이사항이 없거나 권한이 없습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  if (mem.role !== 'LEADER' && mem.role !== 'MANAGER' && note.author_id !== userId) {
    req.session.errorMsg = '본인이 작성한 특이사항만 삭제할 수 있습니다.';
    return res.redirect(`/teams?teamId=${teamId}`);
  }

  db.prepare(`DELETE FROM team_notes WHERE id = ? AND team_id = ?`).run(id, teamId);
  req.session.successMsg = '특이사항이 삭제되었습니다.';
  res.redirect(`/teams?teamId=${teamId}`);
});

// ==========================================
// 10. My Page Routes
// ==========================================

app.get('/mypage', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  const scheduleStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as done,
      SUM(focus_minutes) as focus_total
    FROM schedules WHERE user_id = ?
  `).get(userId);

  const customWidgets = db.prepare(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`).all(userId);

  res.render('mypage', {
    user,
    stats: scheduleStats,
    activeMenu: 'mypage',
    customWidgets,
    dashboardLayout: getEffectiveDashboardLayout(user.dashboard_layout, customWidgets),
    widgetSpecs: WIDGET_SPECS,
    buildCustomWidgetSrcdoc
  });
});

app.post('/mypage/profile', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { name } = req.body;

  if (!name || name.trim() === '') {
    req.session.errorMsg = '이름을 입력해 주세요.';
    return res.redirect('/mypage');
  }

  db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(name.trim(), userId);
  req.session.name = name.trim();
  req.session.successMsg = '프로필 이름이 성공적으로 변경되었습니다.';
  res.redirect('/mypage');
});

app.post('/mypage/password', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const { current_password, new_password, new_password_confirm } = req.body;

  if (!current_password || !new_password) {
    req.session.errorMsg = '현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.';
    return res.redirect('/mypage');
  }

  if (new_password !== new_password_confirm) {
    req.session.errorMsg = '새 비밀번호 확인이 일치하지 않습니다.';
    return res.redirect('/mypage');
  }

  const user = db.prepare(`SELECT password FROM users WHERE id = ?`).get(userId);
  if (!bcrypt.compareSync(current_password, user.password)) {
    req.session.errorMsg = '현재 비밀번호가 올바르지 않습니다.';
    return res.redirect('/mypage');
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(newHash, userId);

  req.session.successMsg = '비밀번호가 성공적으로 변경되었습니다.';
  res.redirect('/mypage');
});

app.post('/mypage/telegram-unlink', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  db.prepare(`UPDATE users SET telegram_chat_id = NULL WHERE id = ?`).run(userId);
  req.session.successMsg = '텔레그램 연동이 해제되었습니다.';
  res.redirect('/mypage');
});

app.post('/mypage/delete-account', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ==========================================
// 11. Admin Control Panel Routes
// ==========================================

function maskSecret(val) {
  if (!val || val.length === 0) return '';
  if (val.length <= 6) return '******';
  return val.substring(0, 6) + '********';
}

app.get('/admin', isAdmin, (req, res) => {
  // 1. KPI Counts
  const totalUsers = db.prepare(`SELECT COUNT(*) as c FROM users`).get().c;
  const totalSchedules = db.prepare(`SELECT COUNT(*) as c FROM schedules`).get().c;
  const todayStr = getKoreanDateString(0);
  const todayAlerts = db.prepare(`
    SELECT COUNT(*) as c FROM notification_logs WHERE created_at LIKE ?
  `).get(`${todayStr}%`).c;
  const connectedTelegramUsers = db.prepare(`
    SELECT COUNT(*) as c FROM users WHERE telegram_chat_id IS NOT NULL
  `).get().c;

  // 2. Settings (masked)
  const rawBotToken = getSetting('telegram_bot_token');
  const rawGeminiKey = getSetting('gemini_api_key');
  const botEnabled = getSetting('bot_enabled') === 'true';

  const settings = {
    telegram_bot_token: maskSecret(rawBotToken),
    gemini_api_key: maskSecret(rawGeminiKey),
    bot_enabled: botEnabled
  };

  // 3. User list with schedule counts
  const users = db.prepare(`
    SELECT u.*, COUNT(s.id) as schedule_count
    FROM users u
    LEFT JOIN schedules s ON s.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();

  // 4. Recent Notification Logs
  const logs = db.prepare(`
    SELECT nl.*, u.name as user_name, u.username
    FROM notification_logs nl
    LEFT JOIN users u ON u.id = nl.user_id
    ORDER BY nl.created_at DESC
    LIMIT 25
  `).all();

  const currentUserData = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.session.userId);

  res.render('admin', {
    user: currentUserData,
    currentUser: currentUserData,
    activeMenu: 'admin',
    kpis: {
      totalUsers,
      totalSchedules,
      todayAlerts,
      connectedTelegramUsers
    },
    settings,
    users,
    logs
  });
});

// Admin Settings Update
app.post('/admin/settings', isAdmin, (req, res) => {
  const { telegram_bot_token, bot_enabled, gemini_api_key } = req.body;

  // If token is not masked placeholder and not empty, update it
  if (telegram_bot_token && !telegram_bot_token.includes('****')) {
    setSetting('telegram_bot_token', telegram_bot_token.trim());
  }
  setSetting('bot_enabled', bot_enabled === 'true' ? 'true' : 'false');

  if (gemini_api_key && !gemini_api_key.includes('****')) {
    setSetting('gemini_api_key', gemini_api_key.trim());
  }

  req.session.successMsg = '시스템 환경설정이 성공적으로 저장되었습니다.';
  res.redirect('/admin');
});

// Admin Broadcast to All Linked Users
app.post('/admin/broadcast', isAdmin, async (req, res) => {
  const { broadcast_message } = req.body;
  if (!broadcast_message || broadcast_message.trim() === '') {
    req.session.errorMsg = '공지 메시지 내용을 입력해 주세요.';
    return res.redirect('/admin');
  }

  const linkedUsers = db.prepare(`SELECT * FROM users WHERE telegram_chat_id IS NOT NULL`).all();
  let successCount = 0;

  for (const user of linkedUsers) {
    const formatted = `📢 [WorkSmarter 시스템 전체 공지]\n\n${broadcast_message.trim()}\n\n- 관리자 드림 -`;
    const ok = await sendTelegramMessage(user.telegram_chat_id, formatted, user.id, 'ADMIN_BROADCAST');
    if (ok) successCount++;
  }

  req.session.successMsg = `총 ${linkedUsers.length}명 중 ${successCount}명에게 전체 공지를 성공적으로 발송했습니다.`;
  res.redirect('/admin');
});

// Reset Telegram for a specific user
app.post('/admin/users/:id/reset-telegram', isAdmin, (req, res) => {
  const targetId = req.params.id;
  db.prepare(`UPDATE users SET telegram_chat_id = NULL, telegram_link_code = NULL WHERE id = ?`).run(targetId);
  req.session.successMsg = `해당 회원의 텔레그램 연동이 초기화되었습니다.`;
  res.redirect('/admin');
});

// Delete user by admin
app.post('/admin/users/:id/delete', isAdmin, (req, res) => {
  const targetId = req.params.id;
  if (parseInt(targetId, 10) === req.session.userId) {
    req.session.errorMsg = '현재 로그인 중인 본인 관리자 계정은 삭제할 수 없습니다.';
    return res.redirect('/admin');
  }

  db.prepare(`DELETE FROM users WHERE id = ?`).run(targetId);
  req.session.successMsg = `회원(ID: ${targetId})이 영구 삭제되었습니다.`;
  res.redirect('/admin');
});

// ==========================================
// 8. Notes & Documentation Workspace Routes (newdawn.md)
// ==========================================

// GET /notes: Main Notes & Documentation Workspace
app.get('/notes', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);

  // 1. Fetch user's notes
  const rawNotes = db.prepare(`
    SELECT * FROM user_notes 
    WHERE user_id = ? 
    ORDER BY updated_at DESC
  `).all(userId);

  // 2. Fetch personal schedules for dropdown linking
  const personalSchedules = db.prepare(`
    SELECT id, title, category, due_datetime 
    FROM schedules 
    WHERE user_id = ? 
    ORDER BY due_datetime IS NULL ASC, due_datetime ASC
  `).all(userId);

  // 3. Fetch team schedules for dropdown linking
  const teamSchedules = db.prepare(`
    SELECT ts.id, ts.title, ts.due_datetime, ts.team_id, t.name as team_name
    FROM team_schedules ts
    JOIN teams t ON t.id = ts.team_id
    WHERE ts.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
    ORDER BY ts.due_datetime IS NULL ASC, ts.due_datetime ASC
  `).all(userId);

  // Process notes with parsed JSON and linked schedule titles
  const notes = rawNotes.map(note => {
    let links = [];
    let attachments = [];
    try { links = JSON.parse(note.links_json || '[]'); } catch (e) { links = []; }
    try {
      attachments = JSON.parse(note.attachments_json || '[]').map(att => ({
        ...att,
        originalName: decodeOriginalname(att.originalName)
      }));
    } catch (e) {
      attachments = [];
    }

    let linkedTitle = null;
    let linkedTeamName = null;
    if (note.linked_type === 'PERSONAL' && note.linked_schedule_id) {
      const ps = personalSchedules.find(s => s.id === note.linked_schedule_id) ||
                 db.prepare(`SELECT title FROM schedules WHERE id = ?`).get(note.linked_schedule_id);
      linkedTitle = ps ? ps.title : null;
    } else if (note.linked_type === 'TEAM' && note.linked_schedule_id) {
      const ts = teamSchedules.find(s => s.id === note.linked_schedule_id) ||
                 db.prepare(`
                   SELECT ts.title, t.name as team_name 
                   FROM team_schedules ts 
                   JOIN teams t ON t.id = ts.team_id 
                   WHERE ts.id = ?
                 `).get(note.linked_schedule_id);
      if (ts) {
        linkedTitle = ts.title;
        linkedTeamName = ts.team_name;
      }
    }

    return {
      ...note,
      links,
      attachments,
      linkedTitle,
      linkedTeamName
    };
  });

  const openNoteId = req.query.noteId ? parseInt(req.query.noteId, 10) : null;

  res.render('notes', {
    user,
    notes,
    personalSchedules,
    teamSchedules,
    activeMenu: 'notes',
    openNoteId
  });
});

// POST /api/notes: Create new Note
app.post('/api/notes', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const title = (req.body.title || '새 문서').trim();
  const content = (req.body.content || '').trim();
  const linked_type = ['PERSONAL', 'TEAM'].includes(req.body.linked_type) ? req.body.linked_type : 'NONE';
  const linked_schedule_id = req.body.linked_schedule_id ? parseInt(req.body.linked_schedule_id, 10) : null;

  const result = db.prepare(`
    INSERT INTO user_notes (user_id, title, content, linked_type, linked_schedule_id, links_json, attachments_json)
    VALUES (?, ?, ?, ?, ?, '[]', '[]')
  `).run(userId, title, content, linked_type, linked_schedule_id);

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(result.lastInsertRowid, userId);
  
  if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
    return res.json({ success: true, note });
  }
  res.redirect(`/notes?noteId=${result.lastInsertRowid}`);
});

// GET /api/notes/:id: Fetch specific note
app.get('/api/notes/:id', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
  }

  let links = [];
  let attachments = [];
  try { links = JSON.parse(note.links_json || '[]'); } catch (e) { links = []; }
  try {
    attachments = JSON.parse(note.attachments_json || '[]').map(att => ({
      ...att,
      originalName: decodeOriginalname(att.originalName)
    }));
  } catch (e) {
    attachments = [];
  }

  res.json({ success: true, note: { ...note, links, attachments } });
});

// POST /api/notes/:id/autosave: Debounced Autosave (1000ms delay from client)
app.post('/api/notes/:id/autosave', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);
  const { title, content, linked_type, linked_schedule_id, links_json } = req.body;

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
  }

  const safeTitle = (title !== undefined && title !== null && title.trim()) ? title.trim() : note.title;
  const safeContent = content !== undefined ? content : note.content;
  const validLinkedType = ['NONE', 'PERSONAL', 'TEAM'].includes(linked_type) ? linked_type : note.linked_type;
  const validLinkedId = (linked_schedule_id !== undefined && linked_schedule_id !== '') ? (parseInt(linked_schedule_id, 10) || null) : (validLinkedType === 'NONE' ? null : note.linked_schedule_id);

  let updatedLinksJson = note.links_json;
  if (links_json !== undefined) {
    try {
      const parsed = typeof links_json === 'string' ? JSON.parse(links_json) : links_json;
      updatedLinksJson = JSON.stringify(parsed);
    } catch (e) {
      // keep existing
    }
  }

  db.prepare(`
    UPDATE user_notes 
    SET title = ?, content = ?, linked_type = ?, linked_schedule_id = ?, links_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(safeTitle, safeContent, validLinkedType, validLinkedId, updatedLinksJson, noteId, userId);

  const updatedNote = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  res.json({ success: true, note: updatedNote, updated_at: updatedNote.updated_at });
});

// POST /api/notes/:id/delete: Delete note
app.post('/api/notes/:id/delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
      return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
    }
    req.session.errorMsg = '문서를 찾을 수 없습니다.';
    return res.redirect('/notes');
  }

  // Delete attached files on disk
  try {
    const attachments = JSON.parse(note.attachments_json || '[]');
    attachments.forEach(att => {
      if (att.storedName) {
        const safeName = path.basename(att.storedName);
        const fPath = path.join(uploadDir, safeName);
        if (fs.existsSync(fPath)) {
          fs.unlinkSync(fPath);
        }
      }
    });
  } catch (err) {
    console.error('Failed to remove attachment files on note deletion:', err);
  }

  db.prepare(`DELETE FROM user_notes WHERE id = ? AND user_id = ?`).run(noteId, userId);

  if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
    return res.json({ success: true });
  }
  req.session.successMsg = '문서가 삭제되었습니다.';
  res.redirect('/notes');
});

// POST /api/notes/:id/links: Update links
app.post('/api/notes/:id/links', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);
  const { links } = req.body;

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
  }

  let linksArray = [];
  try {
    linksArray = typeof links === 'string' ? JSON.parse(links) : (Array.isArray(links) ? links : []);
  } catch (e) {
    return res.status(400).json({ success: false, error: '잘못된 링크 형식입니다.' });
  }

  const safeLinksJson = JSON.stringify(linksArray);
  db.prepare(`
    UPDATE user_notes 
    SET links_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(safeLinksJson, noteId, userId);

  res.json({ success: true, links: linksArray });
});

// POST /api/notes/:id/upload: Multer file upload (Max 5MB, whitelisted exts)
app.post('/api/notes/:id/upload', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);

  // Check ownership first
  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
  }

  uploadNoteAttachment.single('file')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: '파일 크기는 최대 5MB까지 업로드 가능합니다.' });
      }
      return res.status(400).json({ success: false, error: `파일 업로드 오류: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, error: err.message || '파일 업로드에 실패했습니다.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: '업로드할 파일이 선택되지 않았습니다.' });
    }

    let attachments = [];
    try {
      attachments = JSON.parse(note.attachments_json || '[]');
    } catch (e) {
      attachments = [];
    }

    const cleanOriginalName = decodeOriginalname(req.file.originalname);
    const newAttachment = {
      originalName: cleanOriginalName,
      storedName: req.file.filename,
      size: req.file.size,
      uploaded_at: new Date().toISOString()
    };

    attachments.push(newAttachment);

    db.prepare(`
      UPDATE user_notes 
      SET attachments_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(JSON.stringify(attachments), noteId, userId);

    res.json({
      success: true,
      attachment: newAttachment,
      attachments
    });
  });
});

// GET /api/notes/:id/download/:storedName: Download attached file
app.get('/api/notes/:id/download/:storedName', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);
  const storedName = path.basename(req.params.storedName);

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    return res.status(404).send('문서를 찾을 수 없거나 권한이 없습니다.');
  }

  let attachments = [];
  try {
    attachments = JSON.parse(note.attachments_json || '[]');
  } catch (e) {
    attachments = [];
  }

  const att = attachments.find(a => a.storedName === storedName);
  if (!att) {
    return res.status(404).send('해당 첨부 파일을 찾을 수 없습니다.');
  }

  const filePath = path.join(uploadDir, storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('서버에 파일이 존재하지 않습니다.');
  }

  const cleanOriginalName = decodeOriginalname(att.originalName) || 'file';
  res.download(filePath, cleanOriginalName);
});

// POST /api/notes/:id/attachments/delete: Delete attachment
app.post('/api/notes/:id/attachments/delete', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  const noteId = parseInt(req.params.id, 10);
  const { storedName } = req.body;

  if (!storedName) {
    return res.status(400).json({ success: false, error: '삭제할 파일명이 지정되지 않았습니다.' });
  }

  const safeStoredName = path.basename(storedName);

  const note = db.prepare(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`).get(noteId, userId);
  if (!note) {
    return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
  }

  let attachments = [];
  try {
    attachments = JSON.parse(note.attachments_json || '[]');
  } catch (e) {
    attachments = [];
  }

  const targetIdx = attachments.findIndex(a => a.storedName === safeStoredName);
  if (targetIdx === -1) {
    return res.status(404).json({ success: false, error: '해당 첨부 파일을 찾을 수 없습니다.' });
  }

  // Remove file from disk
  const filePath = path.join(uploadDir, safeStoredName);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Failed to unlink file:', e);
    }
  }

  attachments.splice(targetIdx, 1);

  db.prepare(`
    UPDATE user_notes 
    SET attachments_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(JSON.stringify(attachments), noteId, userId);

  res.json({ success: true, attachments });
});

// ==========================================
// 12. Server Startup
// ==========================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` WorkSmarter AI 생산성 & 스마트 비서 서버 시작됨`);
    console.log(` 포트: http://localhost:${PORT}`);
    console.log(` 현재 한국 시간(KST): ${getKoreanTimeString(0)}`);
    console.log(` 관리자 계정: admin / admin1234`);
    console.log(` 일반 테스트 계정: test / 1234`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
