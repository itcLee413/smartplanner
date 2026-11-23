require('dotenv').config();
process.env.TZ = 'Asia/Seoul';

require('dotenv').config();
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
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
// 2. Database Initialization (MySQL mysql2/promise Connection Pool)
// ==========================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'worksmarter',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true
});

const TABLE_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(191) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'USER',
    telegram_link_code VARCHAR(100),
    telegram_chat_id VARCHAR(100),
    dashboard_layout MEDIUMTEXT,
    quick_memo MEDIUMTEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_datetime VARCHAR(50) DEFAULT NULL,
    category VARCHAR(50) DEFAULT '개인',
    status VARCHAR(50) DEFAULT 'TODO',
    is_top3 TINYINT DEFAULT 0,
    is_important TINYINT DEFAULT 0,
    is_notified TINYINT DEFAULT 0,
    focus_minutes INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS subtasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schedule_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    is_done TINYINT DEFAULT 0,
    sort_order INT DEFAULT 0,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS system_settings (
    \`key\` VARCHAR(191) PRIMARY KEY,
    value TEXT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS notification_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    type VARCHAR(100),
    message TEXT,
    status VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS teams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    invite_code VARCHAR(100) UNIQUE NOT NULL,
    owner_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    user_id INT NOT NULL,
    position VARCHAR(100) DEFAULT '팀원',
    role VARCHAR(50) DEFAULT 'MEMBER',
    sort_order INT DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_team_user (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS team_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    author_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_datetime VARCHAR(50) DEFAULT NULL,
    status VARCHAR(50) DEFAULT 'TODO',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS team_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    author_id INT NOT NULL,
    category VARCHAR(100) DEFAULT '특이사항',
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_pinned TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS team_schedule_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    schedule_id INT DEFAULT NULL,
    schedule_title VARCHAR(255),
    editor_id INT NOT NULL,
    action_type VARCHAR(100),
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (editor_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS user_top3_team_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    team_schedule_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_team_sched (user_id, team_schedule_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_schedule_id) REFERENCES team_schedules(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS user_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT,
    linked_type VARCHAR(50) DEFAULT 'NONE',
    linked_schedule_id INT DEFAULT NULL,
    links_json LONGTEXT,
    attachments_json LONGTEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS user_custom_widgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    html_code LONGTEXT,
    css_code LONGTEXT,
    js_code LONGTEXT,
    default_w INT DEFAULT 4,
    default_h INT DEFAULT 3,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS team_invitations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    inviter_id INT NOT NULL,
    invitee_id INT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    link_url VARCHAR(255) DEFAULT '',
    is_read TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
];

// In-Memory Settings Cache
const settingsCache = {};

async function loadSettings() {
  try {
    const [rows] = await pool.query('SELECT `key`, value FROM system_settings');
    for (const row of rows) {
      settingsCache[row.key] = row.value;
    }
  } catch (err) {
    console.error('Failed to load system settings into cache:', err.message);
  }
}

async function getSetting(key) {
  if (settingsCache[key] !== undefined) return settingsCache[key];
  try {
    const [rows] = await pool.query('SELECT value FROM system_settings WHERE `key` = ?', [key]);
    if (rows && rows.length > 0 && rows[0].value !== null && rows[0].value !== undefined) {
      settingsCache[key] = rows[0].value;
      return rows[0].value;
    }
  } catch (err) {}
  if (key === 'telegram_bot_token') return process.env.TELEGRAM_BOT_TOKEN || '';
  if (key === 'gemini_api_key') return process.env.GEMINI_API_KEY || '';
  if (key === 'bot_enabled') return process.env.TELEGRAM_BOT_TOKEN ? 'true' : 'false';
  return '';
}

async function setSetting(key, value) {
  settingsCache[key] = value;
  await pool.query(
    'INSERT INTO system_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [key, value]
  );
}

// Helper to fix Korean / UTF-8 filename garbling from Multer / Busboy (latin1 -> utf-8)
function decodeOriginalname(name) {
  if (!name) return '';
  if (/[^\x00-\xFF]/.test(name)) {
    return name;
  }
  if (!/[^\x00-\x7F]/.test(name)) {
    return name;
  }
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) {
      return decoded;
    }
  } catch (e) {}
  return name;
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
async function logTeamScheduleAction(teamId, scheduleId, scheduleTitle, editorId, actionType, detail) {
  try {
    await pool.query(`
      INSERT INTO team_schedule_logs (team_id, schedule_id, schedule_title, editor_id, action_type, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [teamId, scheduleId || null, scheduleTitle || '', editorId, actionType, detail || '']);
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

// ==========================================
// Modular Dashboard System Constants & Helpers (modules.md)
// ==========================================
const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'top3', x: 0, y: 0, w: 12, h: 3, enabled: true },
  { id: 'workspace', x: 0, y: 3, w: 8, h: 7, enabled: true },
  { id: 'stats', x: 8, y: 3, w: 4, h: 4, enabled: true },
  { id: 'quick_add', x: 8, y: 7, w: 4, h: 3, enabled: true },
  { id: 'clock', x: 0, y: 10, w: 4, h: 2, enabled: false },
  { id: 'memo', x: 4, y: 10, w: 8, h: 3, enabled: false }
];

const VALID_WIDGET_IDS = ['top3', 'workspace', 'stats', 'quick_add', 'clock', 'memo'];

const WIDGET_SPECS = {
  top3: { title: '오늘의 핵심 목표 Top 3', defaultW: 12, defaultH: 3, defaultEnabled: true },
  workspace: { title: '일정 워크스페이스 (칸반/캘린더/소속팀)', defaultW: 8, defaultH: 7, defaultEnabled: true },
  stats: { title: '카테고리별 생산성 통계 차트', defaultW: 4, defaultH: 4, defaultEnabled: true },
  quick_add: { title: '새 일정 빠른 등록 폼', defaultW: 4, defaultH: 3, defaultEnabled: true },
  clock: { title: '실시간 디지털 시계 & 오늘의 날짜', defaultW: 4, defaultH: 2, defaultEnabled: false },
  memo: { title: '빠른 포스트잇 메모장', defaultW: 8, defaultH: 3, defaultEnabled: false }
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
        const isEnabled = (found.enabled === false || found.enabled === 0 || found.enabled === 'false') ? false : true;
        result.push({
          id: customId,
          x: typeof found.x === 'number' ? Math.max(0, found.x) : 0,
          y: typeof found.y === 'number' ? Math.max(0, found.y) : maxY,
          w: typeof found.w === 'number' ? Math.max(1, Math.min(12, found.w)) : (cw.default_w || 4),
          h: typeof found.h === 'number' ? Math.max(1, found.h) : (cw.default_h || 3),
          enabled: isEnabled
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
async function initDummyData() {
  const [userRows] = await pool.query('SELECT COUNT(*) as count FROM users');
  if (userRows[0].count === 0) {
    console.log('초기 더미 데이터(관리자 및 테스트 사용자)를 생성합니다...');
    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync('admin1234', salt);
    const testHash = bcrypt.hashSync('1234', salt);

    await pool.query('INSERT INTO users (username, password, name, role, telegram_link_code) VALUES (?, ?, ?, ?, ?)',
      ['admin', adminHash, '시스템관리자', 'ADMIN', 'ADM001']
    );
    const [testUserRes] = await pool.query('INSERT INTO users (username, password, name, role, telegram_link_code) VALUES (?, ?, ?, ?, ?)',
      ['test', testHash, '홍길동', 'USER', 'TST123']
    );
    const testUserId = testUserRes.insertId;

    const todayStr = getKoreanDateString(0);
    const tomorrowStr = getKoreanDateString(1);

    // Sample Schedule 1 (Top 3 & Important)
    const [s1] = await pool.query(
      `INSERT INTO schedules (user_id, title, description, due_datetime, category, status, is_top3, is_important)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testUserId,
        'AWS EC2 배포 및 발표자료 최종 리허설',
        '1. 서론: 프로젝트 배경 및 시스템 아키텍처 요약\n2. 본론: EC2 Ubuntu 배포 환경 및 PM2 무중단 구동 시연\n3. 결론: 텔레그램 스마트 비서 실시간 브리핑 데모',
        `${todayStr} 17:00`,
        '팀프로젝트',
        'IN_PROGRESS',
        1,
        1
      ]
    );
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s1.insertId, 'EC2 인스턴스 보안그룹 포트 및 도메인 바인딩 점검', 1]);
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s1.insertId, '텔레그램 봇 /link 코드 연동 및 즉시 브리핑 테스트', 1]);
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s1.insertId, '발표 슬라이드 10분 타임어택 최종 리허설', 0]);

    // Sample Schedule 2
    const [s2] = await pool.query(
      `INSERT INTO schedules (user_id, title, description, due_datetime, category, status, is_top3, is_important)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testUserId,
        '알고리즘 문제 풀이 및 포모도로 4세트',
        '백준/프로그래머스 그래프 탐색(BFS/DFS) 및 DP 기출 3문제 풀이\n포모도로 25분 x 4세트 몰입 집중 실행',
        `${todayStr} 21:00`,
        '자기계발',
        'TODO',
        0,
        0
      ]
    );
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s2.insertId, '백준 1260번 DFS와 BFS 풀이 및 검증', 0]);
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s2.insertId, '백준 2667번 단지번호붙이기 풀이', 0]);
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s2.insertId, '오답 노트 정리 및 핵심 시간복잡도 기록', 0]);

    // Sample Schedule 3
    const [s3] = await pool.query(
      `INSERT INTO schedules (user_id, title, description, due_datetime, category, status, is_top3, is_important)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testUserId,
        '클라우드 컴퓨팅 종합 보고서 제출',
        'GitHub 리포지토리 README.md 배포 가이드 최신화\n동작 영상 링크 첨부 및 PDF 변환 후 과제방 업로드',
        `${tomorrowStr} 14:00`,
        '업무',
        'TODO',
        1,
        1
      ]
    );
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s3.insertId, 'README.md 내 EC2 배포 명령어 및 환경변수 가이드 검증', 1]);
    await pool.query('INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, ?)', [s3.insertId, '과제 제출 양식 최종 서명 및 PDF 업로드', 0]);

    console.log('초기 데이터베이스 설정 완료: test(1234) / admin(admin1234)');
  }

  const [teamRows] = await pool.query('SELECT COUNT(*) as count FROM teams');
  if (teamRows[0].count === 0) {
    const [testUsers] = await pool.query('SELECT id FROM users WHERE username = ?', ['test']);
    if (testUsers.length > 0) {
      const testUser = testUsers[0];
      const todayStr = getKoreanDateString(0);
      const tomorrowStr = getKoreanDateString(1);

      const [teamInsert] = await pool.query(
        `INSERT INTO teams (name, description, invite_code, owner_id) VALUES (?, ?, ?, ?)`,
        [
          '스마트팩토리 네트워크 구축팀',
          '스마트팩토리 센서 데이터 수집 IoT 게이트웨이 및 실시간 관제 시스템 구축 팀입니다.',
          'SFNET2026',
          testUser.id
        ]
      );
      const sampleTeamId = teamInsert.insertId;

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, position, role) VALUES (?, ?, ?, ?)`,
        [sampleTeamId, testUser.id, '팀장', 'LEADER']
      );

      await pool.query(
        `INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sampleTeamId,
          testUser.id,
          '공장 IoT 센서 디바이스 프로토콜 연동 테스트',
          'Modbus/MQTT 프로토콜 패킷 데이터 수신 검증 및 게이트웨이 지연시간 50ms 이내 유지 테스트',
          `${todayStr} 16:00`,
          'IN_PROGRESS'
        ]
      );
      await pool.query(
        `INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sampleTeamId,
          testUser.id,
          '중간 발표 데모 시나리오 점검 및 네트워크 보안 점검',
          'VPN 망 분리 및 방화벽 인바운드 룰 최종 확인, 시연 동선 및 발표 슬라이드 점검',
          `${tomorrowStr} 15:00`,
          'TODO'
        ]
      );

      await pool.query(
        `INSERT INTO team_notes (team_id, author_id, category, title, content, is_pinned) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sampleTeamId,
          testUser.id,
          '공지',
          '[필독] 게이트웨이 펌웨어 업데이트 시 사전 공지 필수',
          '각 작업 구역 PLC 및 게이트웨이 펌웨어 배포 시 반드시 30분 전 슬랙 및 팀 공지로 알림 후 진행해 주세요. 비인가 포트 개방은 엄격히 금지됩니다.',
          1
        ]
      );
      console.log('샘플 팀 더미 데이터 생성 완료: 스마트팩토리 네트워크 구축팀 (초대코드: SFNET2026)');
    }
  }
}

// ==========================================
// 2-1. Team Leader Auto-Repair & Safe Promotion Helper
// ==========================================
async function ensureTeamLeader(teamId) {
  if (!teamId) return null;
  const tid = parseInt(teamId, 10);
  if (isNaN(tid)) return null;

  const [teams] = await pool.query('SELECT id, owner_id FROM teams WHERE id = ?', [tid]);
  const team = teams[0];
  if (!team) return null;

  // 1. 유령 팀 체크: 멤버가 아예 0명인 유령 팀 자동 정리
  const [memberCountRows] = await pool.query('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?', [tid]);
  const totalMemberCount = memberCountRows[0].count;
  if (totalMemberCount === 0) {
    console.log(`[Auto-Repair] 멤버가 0명인 유령 팀(ID: ${tid})을 자동 정리합니다.`);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM team_schedule_logs WHERE team_id = ?', [tid]);
      await conn.query('DELETE FROM team_notes WHERE team_id = ?', [tid]);
      await conn.query('DELETE FROM team_schedules WHERE team_id = ?', [tid]);
      await conn.query('DELETE FROM team_members WHERE team_id = ?', [tid]);
      await conn.query('DELETE FROM teams WHERE id = ?', [tid]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return null;
  }

  // 2. 리더(role = 'LEADER') 존재 여부 확인
  const [leaderRows] = await pool.query(`SELECT COUNT(*) as count FROM team_members WHERE team_id = ? AND role = 'LEADER'`, [tid]);
  const leaderCount = leaderRows[0].count;
  if (leaderCount === 0) {
    const [oldestMembers] = await pool.query(`
      SELECT id, user_id, position, role
      FROM team_members 
      WHERE team_id = ? 
      ORDER BY joined_at ASC, id ASC 
      LIMIT 1
    `, [tid]);
    const oldestMember = oldestMembers[0];

    if (oldestMember) {
      const newPosition = (oldestMember.position === '팀원' || !oldestMember.position) ? '팀장' : oldestMember.position;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(`
          UPDATE team_members 
          SET role = 'LEADER', position = ? 
          WHERE id = ?
        `, [newPosition, oldestMember.id]);

        await conn.query(`
          UPDATE teams 
          SET owner_id = ? 
          WHERE id = ?
        `, [oldestMember.user_id, tid]);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      console.log(`[Auto-Repair] 팀(ID: ${tid})에 리더가 없어 최고참 멤버(ID: ${oldestMember.id}, UserID: ${oldestMember.user_id})를 리더(LEADER)로 자동 승급 완료`);
      return oldestMember;
    }
  } else {
    const [ownerMembers] = await pool.query(`SELECT id, role FROM team_members WHERE team_id = ? AND user_id = ?`, [tid, team.owner_id]);
    const ownerMember = ownerMembers[0];
    if (!ownerMember || ownerMember.role !== 'LEADER') {
      const [leaders] = await pool.query(`
        SELECT user_id FROM team_members 
        WHERE team_id = ? AND role = 'LEADER' 
        ORDER BY joined_at ASC, id ASC 
        LIMIT 1
      `, [tid]);
      if (leaders.length > 0) {
        await pool.query(`UPDATE teams SET owner_id = ? WHERE id = ?`, [leaders[0].user_id, tid]);
      }
    }
  }

  return null;
}

// 서버 시작 시 일괄 복구 로직 (DB 초기화 직후 실행)
async function repairAllTeamsWithoutLeader() {
  try {
    const [allTeams] = await pool.query('SELECT id FROM teams');
    for (const team of allTeams) {
      await ensureTeamLeader(team.id);
    }
  } catch (err) {
    console.error('Failed to repair teams without leader on startup:', err);
  }
}

// Database Initialization Routine
async function initDatabase() {
  const conn = await pool.getConnection();
  try {
    console.log('[DB] MySQL 데이터베이스 연결 성공');
    for (const schema of TABLE_SCHEMAS) {
      await conn.query(schema);
    }
    console.log('[DB] 모든 InnoDB 테이블 스키마 초기화 완료');

    // System settings default values
    const initBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const initBotEnabled = initBotToken ? 'true' : 'false';
    const initGeminiKey = process.env.GEMINI_API_KEY || '';
    await conn.query('INSERT IGNORE INTO system_settings (`key`, value) VALUES (?, ?)', ['telegram_bot_token', initBotToken]);
    await conn.query('INSERT IGNORE INTO system_settings (`key`, value) VALUES (?, ?)', ['bot_enabled', initBotEnabled]);
    await conn.query('INSERT IGNORE INTO system_settings (`key`, value) VALUES (?, ?)', ['gemini_api_key', initGeminiKey]);
  } finally {
    conn.release();
  }

  await loadSettings();

  // Migration: Automatically fix any existing corrupted Korean attachment filenames in user_notes
  try {
    const [existingNotes] = await pool.query(`SELECT id, attachments_json FROM user_notes WHERE attachments_json IS NOT NULL AND attachments_json != '[]'`);
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
          await pool.query(`UPDATE user_notes SET attachments_json = ? WHERE id = ?`, [JSON.stringify(atts), n.id]);
          console.log(`[Migration] Healed Korean attachment filenames for note ID ${n.id}`);
        }
      } catch (err) {}
    }
  } catch (e) {
    console.error('Note attachments migration error:', e);
  }

  await initDummyData();
  await repairAllTeamsWithoutLeader();
}

// ==========================================
// 3. Telegram Rich Briefing & Bot Engine
// ==========================================
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
  const rawToken = await getSetting('telegram_bot_token');
  const token = (rawToken || '').trim();
  const cleanChatId = chatId ? String(chatId).trim() : '';

  if (!token || !cleanChatId || !/^-?\d+$/.test(cleanChatId)) {
    if (userId) {
      try {
        await pool.query(`INSERT INTO notification_logs (user_id, type, message, status) VALUES (?, ?, ?, ?)`,
          [userId, type, (text || '').slice(0, 500), 'FAILED']
        );
      } catch (e) {}
    }
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: text
      }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    const status = data.ok ? 'SUCCESS' : 'FAILED';
    if (userId) {
      try {
        await pool.query(`INSERT INTO notification_logs (user_id, type, message, status) VALUES (?, ?, ?, ?)`,
          [userId, type, (text || '').slice(0, 500), status]
        );
      } catch (e) {}
    }
    return data.ok;
  } catch (err) {
    const causeMsg = err.cause ? (err.cause.message || JSON.stringify(err.cause)) : '';
    console.error(`텔레그램 발송 오류: ${err.message}${causeMsg ? ` (원인: ${causeMsg})` : ''}`);
    if (userId) {
      try {
        await pool.query(`INSERT INTO notification_logs (user_id, type, message, status) VALUES (?, ?, ?, ?)`,
          [userId, type, (text || '').slice(0, 500), 'FAILED']
        );
      } catch (e) {}
    }
    return false;
  }
}

let lastUpdateId = 0;
let isPolling = false;

async function pollTelegramBot() {
  if (isPolling) return;
  const botEnabled = (await getSetting('bot_enabled')) === 'true';
  const rawToken = await getSetting('telegram_bot_token');
  const token = (rawToken || '').trim();

  if (!botEnabled || !token) {
    return;
  }

  isPolling = true;
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=2`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

          const [users] = await pool.query(`SELECT * FROM users WHERE telegram_link_code = ?`, [code]);
          const targetUser = users[0];
          if (targetUser) {
            await pool.query(`UPDATE users SET telegram_chat_id = ? WHERE id = ?`, [chatId, targetUser.id]);
            const welcomeText = `🎉 반갑습니다, ${targetUser.name}님!\nWorkSmarter 스마트 비서와 성공적으로 연동되었습니다.\n\n앞으로 등록하신 중요 일정 알림과 포모도로 집중 완료 피드백을 실시간으로 브리핑해 드립니다.\n\n[사용 가능한 명령어]\n• /오늘일정 : 오늘 예정된 일정과 체크리스트 브리핑\n• /완료 [일정ID] : 해당 일정 완료(DONE) 처리\n• /도움말 : 안내 다시 보기`;
            await sendTelegramMessage(chatId, welcomeText, targetUser.id, 'TEST_ALERT');
          } else {
            await sendTelegramMessage(chatId, `❌ 일치하는 연동 코드를 찾을 수 없습니다.\n웹 화면에서 새로고침하여 코드를 확인해 주세요.`);
          }
          continue;
        }

        // Check if user is linked
        const [linkedUsers] = await pool.query(`SELECT * FROM users WHERE telegram_chat_id = ?`, [chatId]);
        const user = linkedUsers[0];

        // 2. /오늘일정
        if (text === '/오늘일정') {
          if (!user) {
            await sendTelegramMessage(chatId, `⚠️ 먼저 계정 연동을 완료해 주세요.\n웹 대시보드에서 코드를 발급받은 뒤 /link [코드] 를 입력하세요.`);
            continue;
          }

          const todayPrefix = getKoreanDateString(0);
          const [todaySchedules] = await pool.query(`
            SELECT * FROM schedules 
            WHERE user_id = ? AND due_datetime LIKE ?
            ORDER BY due_datetime ASC
          `, [user.id, `${todayPrefix}%`]);

          if (todaySchedules.length === 0) {
            await sendTelegramMessage(chatId, `📅 오늘(${todayPrefix}) 예정된 일정이 없습니다. 편안하고 생산적인 하루 보내세요! ✨`, user.id, 'SCHEDULE_ALERT');
          } else {
            let reply = `📅 [${user.name}님의 오늘 일정 브리핑 (${todayPrefix})]\n총 ${todaySchedules.length}개의 일정이 있습니다.\n----------------------------\n`;
            for (const s of todaySchedules) {
              const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [s.id]);
              reply += `\n[ID: ${s.id}] ${s.status === 'DONE' ? '✅' : '⏳'} ${s.title} (${(s.due_datetime || '').split(' ')[1] || s.due_datetime})\n카테고리: ${s.category}`;
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

          const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, user.id]);
          const sched = scheds[0];
          if (!sched) {
            await sendTelegramMessage(chatId, `❌ ID ${scheduleId} 일정을 찾을 수 없거나 회원님의 일정이 아닙니다.`);
            continue;
          }

          await pool.query(`UPDATE schedules SET status = 'DONE' WHERE id = ?`, [scheduleId]);
          await sendTelegramMessage(chatId, `🎉 축하합니다!\n"[${sched.title}]" 일정을 완료(DONE) 처리했습니다. 수고하셨습니다! ⭐`, user.id, 'SCHEDULE_ALERT');
          continue;
        }

        // 4. Default Help
        if (text.startsWith('/help') || text.startsWith('/도움말')) {
          await sendTelegramMessage(chatId, `📋 [WorkSmarter 텔레그램 명령어 안내]\n\n• /link [연동코드] : 웹 계정과 1:1 연결\n• /오늘일정 : 오늘 등록된 모든 일정 및 세부 진행상황 확인\n• /완료 [일정ID] : 지정한 일정 즉시 완료 처리\n• /도움말 : 이 안내 메시지 출력`);
          continue;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      const causeMsg = err.cause ? (err.cause.message || JSON.stringify(err.cause)) : '';
      console.error(`텔레그램 폴링 오류: ${err.message}${causeMsg ? ` (원인: ${causeMsg})` : ''}`);
    }
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
  const apiKey = await getSetting('gemini_api_key');
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
  const botEnabled = (await getSetting('bot_enabled')) === 'true';
  const token = await getSetting('telegram_bot_token');
  if (!botEnabled || !token) return;

  const currentKST = getKoreanTimeString(0);

  try {
    const [dueSchedules] = await pool.query(`
      SELECT s.*, u.telegram_chat_id, u.name as user_name
      FROM schedules s
      JOIN users u ON s.user_id = u.id
      WHERE s.due_datetime = ? 
        AND s.is_important = 1 
        AND s.is_notified = 0 
        AND u.telegram_chat_id IS NOT NULL
    `, [currentKST]);

    for (const schedule of dueSchedules) {
      const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [schedule.id]);
      const briefing = formatScheduleBriefing(schedule, subtasks);

      const ok = await sendTelegramMessage(schedule.telegram_chat_id, briefing, schedule.user_id, 'SCHEDULE_ALERT');
      if (ok) {
        await pool.query(`UPDATE schedules SET is_notified = 1 WHERE id = ?`, [schedule.id]);
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

// Guest Mode Guard Middlewares (third.md 2번)
function requireMemberAccount(req, res, next) {
  if (req.session && req.session.isGuest) {
    req.session.errorMsg = '게스트 모드에서는 개인 대시보드 체험만 가능합니다. 전체 기능을 사용하려면 로그인해 주세요.';
    return res.redirect('/');
  }
  next();
}

function bypassForGuest(req, res, next) {
  if (req.session && req.session.isGuest) {
    if (req.method === 'GET') {
      return res.redirect('/');
    }
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ success: true, isGuest: true });
    }
    return res.redirect('/');
  }
  next();
}

app.use('/schedules', bypassForGuest);
app.use('/api/top3', bypassForGuest);
app.use('/api/dashboard', bypassForGuest);
app.use('/subtasks', bypassForGuest);

// Global Notification & Team Invitation Context Middleware (second.md 3번)
app.use(async (req, res, next) => {
  if (req.session && req.session.userId && !req.session.isGuest) {
    try {
      const userId = req.session.userId;
      const [userNotifications] = await pool.query(`
        SELECT * FROM notifications 
        WHERE user_id = ? 
        ORDER BY id DESC LIMIT 30
      `, [userId]);

      const [userInvitations] = await pool.query(`
        SELECT ti.*, t.name as team_name, u.name as inviter_name, u.username as inviter_username
        FROM team_invitations ti
        JOIN teams t ON t.id = ti.team_id
        JOIN users u ON u.id = ti.inviter_id
        WHERE ti.invitee_id = ? AND ti.status = 'PENDING'
        ORDER BY ti.id DESC
      `, [userId]);

      const unreadNotifCount = userNotifications.filter(n => n.is_read === 0).length;
      const pendingInviteCount = userInvitations.length;

      res.locals.userNotifications = userNotifications;
      res.locals.userInvitations = userInvitations;
      res.locals.unreadNotifCount = unreadNotifCount;
      res.locals.pendingInviteCount = pendingInviteCount;
      res.locals.totalBadgeCount = unreadNotifCount + pendingInviteCount;
    } catch (e) {
      console.error('Error fetching notification locals:', e);
      res.locals.userNotifications = [];
      res.locals.userInvitations = [];
      res.locals.unreadNotifCount = 0;
      res.locals.pendingInviteCount = 0;
      res.locals.totalBadgeCount = 0;
    }
  } else {
    res.locals.userNotifications = [];
    res.locals.userInvitations = [];
    res.locals.unreadNotifCount = 0;
    res.locals.pendingInviteCount = 0;
    res.locals.totalBadgeCount = 0;
  }
  next();
});

// ==========================================
// User Schedule Statistics Helper (stastics.md)
// ==========================================
async function syncExpiredSchedules(userId) {
  try {
    const currentKST = getKoreanTimeString(0);
    await pool.query(`
      UPDATE schedules 
      SET status = 'EXPIRED' 
      WHERE user_id = ? 
        AND status NOT IN ('DONE', 'EXPIRED') 
        AND due_datetime IS NOT NULL 
        AND due_datetime != '' 
        AND due_datetime < ?
    `, [userId, currentKST]);
  } catch (err) {
    console.error('Failed to sync expired schedules:', err);
  }
}

async function getUserScheduleStats(userId) {
  const [schedules] = await pool.query(`SELECT * FROM schedules WHERE user_id = ?`, [userId]);
  const totalCount = schedules.length;
  const todoCount = schedules.filter(s => s.status === 'TODO').length;
  const inProgressCount = schedules.filter(s => s.status === 'IN_PROGRESS').length;
  const doneCount = schedules.filter(s => s.status === 'DONE').length;
  const expiredCount = schedules.filter(s => s.status === 'EXPIRED').length;
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
    expiredCount,
    completionRate,
    totalFocusMinutes,
    categoryStats
  };
}

// ==========================================
// 7. Authentication Routes
// ==========================================
// Guest Mode Entry Route (third.md 2번)
app.get('/guest', async (req, res, next) => {
  try {
    req.session.isGuest = true;
    req.session.userId = 'guest';
    req.session.username = 'guest';
    req.session.name = '게스트';
    req.session.role = 'GUEST';
    return res.redirect('/');
  } catch (err) {
    next(err);
  }
});

app.get('/login', async (req, res, next) => {
  try {
    if (req.session.userId && !req.session.isGuest) {
      return res.redirect('/');
    }
    if (req.session.isGuest) {
      delete req.session.isGuest;
      delete req.session.userId;
      delete req.session.username;
      delete req.session.name;
      delete req.session.role;
    }
    res.render('login');
  } catch (err) {
    next(err);
  }
});

app.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      req.session.errorMsg = '아이디와 비밀번호를 모두 입력해 주세요.';
      return res.redirect('/login');
    }

    const [users] = await pool.query(`SELECT * FROM users WHERE username = ?`, [username.trim()]);
    const user = users[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      req.session.errorMsg = '아이디 또는 비밀번호가 일치하지 않습니다.';
      return res.redirect('/login');
    }

    // Set session
    delete req.session.isGuest;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.name = user.name;
    req.session.role = user.role;

    if (user.role === 'ADMIN') {
      return res.redirect('/admin');
    }
    return res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    next(err);
  }
});

app.get('/register', async (req, res, next) => {
  try {
    if (req.session.userId && !req.session.isGuest) return res.redirect('/');
    if (req.session.isGuest) {
      delete req.session.isGuest;
      delete req.session.userId;
      delete req.session.username;
      delete req.session.name;
      delete req.session.role;
    }
    res.render('register');
  } catch (err) {
    next(err);
  }
});

app.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { username, password, password_confirm, name } = req.body;
    if (!username || !password || !name) {
      req.session.errorMsg = '모든 필드를 입력해 주세요.';
      return res.redirect('/register');
    }
    if (password !== password_confirm) {
      req.session.errorMsg = '비밀번호 확인이 일치하지 않습니다.';
      return res.redirect('/register');
    }

    const [existingUsers] = await pool.query(`SELECT id FROM users WHERE username = ?`, [username.trim()]);
    if (existingUsers.length > 0) {
      req.session.errorMsg = '이미 존재하는 사용자 아이디입니다.';
      return res.redirect('/register');
    }

    const hash = bcrypt.hashSync(password, 10);
    const linkCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await pool.query(`
      INSERT INTO users (username, password, name, role, telegram_link_code)
      VALUES (?, ?, ?, 'USER', ?)
    `, [username.trim(), hash, name.trim(), linkCode]);

    delete req.session.isGuest;
    delete req.session.userId;
    delete req.session.username;
    delete req.session.name;
    delete req.session.role;

    req.session.successMsg = '회원가입이 완료되었습니다. 로그인해 주세요!';
    return res.redirect('/login');
  } catch (err) {
    console.error('Register error:', err);
    next(err);
  }
});

app.get('/logout', async (req, res, next) => {
  try {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 8. Main Dashboard & Schedule Routes
// ==========================================

app.get('/', isAuthenticated, async (req, res, next) => {
  try {
    if (req.session.isGuest) {
      const guestUser = {
        id: 'guest',
        username: 'guest',
        name: '게스트',
        role: 'GUEST',
        telegram_chat_id: null,
        quick_memo: '',
        dashboard_layout: null
      };

      return res.render('index', {
        user: guestUser,
        schedules: [],
        top3Schedules: [],
        top3List: [],
        stats: {
          totalCount: 0,
          todoCount: 0,
          inProgressCount: 0,
          doneCount: 0,
          expiredCount: 0,
          completionRate: 0,
          totalFocusMinutes: 0,
          categoryStats: { '업무': 0, '개인': 0, '팀프로젝트': 0, '자기계발': 0 }
        },
        botEnabled: false,
        notificationLogs: [],
        myTeams: [],
        teamSchedules: [],
        activeMenu: 'dashboard',
        currentKSTDate: getKoreanDateString(0),
        customWidgets: [],
        dashboardLayout: getEffectiveDashboardLayout(null, []),
        widgetSpecs: WIDGET_SPECS,
        buildCustomWidgetSrcdoc,
        isGuest: true
      });
    }

    const userId = req.session.userId;

    // 1. Fetch user info
    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];

    // 2. Fetch user notes for schedule linking
    const [userNotes] = await pool.query(`
      SELECT id, title, linked_type, linked_schedule_id 
      FROM user_notes 
      WHERE user_id = ?
    `, [userId]);

    // Auto classify expired schedules
    await syncExpiredSchedules(userId);

    // 3. Fetch all schedules
    const [rawSchedules] = await pool.query(`
      SELECT * FROM schedules 
      WHERE user_id = ? 
      ORDER BY due_datetime IS NULL ASC, due_datetime ASC
    `, [userId]);

    // Attach subtasks, percent, and linked_notes to each schedule
    let allSubtasks = [];
    if (rawSchedules.length > 0) {
      const sids = rawSchedules.map(s => s.id);
      const placeholders = sids.map(() => '?').join(',');
      const [subRows] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`, sids);
      allSubtasks = subRows;
    }

    const schedules = rawSchedules.map(sched => {
      const subtasks = allSubtasks.filter(st => st.schedule_id === sched.id);
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

    const [teamTop3Rows] = await pool.query(`
      SELECT ts.*, t.name as team_name, u.name as author_name, 'TEAM' as itemType,
             ut.created_at as top3_created_at
      FROM user_top3_team_schedules ut
      JOIN team_schedules ts ON ts.id = ut.team_schedule_id
      JOIN teams t ON t.id = ts.team_id
      LEFT JOIN users u ON u.id = ts.author_id
      WHERE ut.user_id = ?
      ORDER BY ut.created_at ASC, ts.due_datetime IS NULL ASC, ts.due_datetime ASC
    `, [userId]);

    const teamTop3 = teamTop3Rows.map(sched => {
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
    const stats = await getUserScheduleStats(userId);

    // Recent notification logs
    const [notificationLogs] = await pool.query(`
      SELECT * FROM notification_logs 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 6
    `, [userId]);

    // Telegram bot system enabled status
    const botEnabled = (await getSetting('bot_enabled')) === 'true';

    // 6. Fetch user's teams for direct schedule creation
    const [myTeams] = await pool.query(`
      SELECT t.id, t.name, tm.position, tm.role, tm.sort_order
      FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = ?
      ORDER BY tm.sort_order ASC, tm.joined_at ASC
    `, [userId]);

    // 7. Fetch all team schedules for teams this user belongs to
    const [teamScheduleRows] = await pool.query(`
      SELECT ts.*, t.name as team_name, u.name as author_name, COALESCE(tm.position, '팀원') as author_position, tm.role as author_role
      FROM team_schedules ts
      JOIN teams t ON t.id = ts.team_id
      JOIN users u ON u.id = ts.author_id
      LEFT JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ts.author_id
      WHERE ts.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
      ORDER BY ts.due_datetime IS NULL ASC, ts.due_datetime ASC
    `, [userId]);

    const teamSchedules = teamScheduleRows.map(ts => ({
      ...ts,
      linked_notes: userNotes.filter(n => n.linked_type === 'TEAM' && n.linked_schedule_id === ts.id)
    }));

    // 8. Fetch user's custom widgets (moduleplus.md)
    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);

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
      dashboardLayout: getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets),
      widgetSpecs: WIDGET_SPECS,
      buildCustomWidgetSrcdoc,
      isGuest: false
    });
  } catch (err) {
    console.error('Error in GET /:', err);
    next(err);
  }
});

// Create Schedule (Standard or Team Direct)
app.post('/schedules', isAuthenticated, async (req, res, next) => {
  try {
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
        const [memberships] = await pool.query(`
          SELECT * FROM team_members 
          WHERE team_id = ? AND user_id = ?
        `, [teamId, userId]);

        if (memberships.length === 0) {
          req.session.errorMsg = '해당 팀에 일정을 등록할 권한이 없거나 가입되어 있지 않습니다.';
          return res.redirect('/');
        }

        const [insertResult] = await pool.query(`
          INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
          VALUES (?, ?, ?, ?, ?, 'TODO')
        `, [
          teamId,
          userId,
          title.trim(),
          (description || '').trim(),
          formattedDateTime
        ]);

        // Audit Log
        await logTeamScheduleAction(teamId, insertResult.insertId, title.trim(), userId, 'CREATED', '대시보드에서 직접 등록');

        req.session.successMsg = '팀 일정으로 등록되었습니다.';
        return res.redirect('/');
      }
    }

    // Otherwise, insert into personal schedules
    await pool.query(`
      INSERT INTO schedules (user_id, title, description, due_datetime, category, status, is_top3, is_important)
      VALUES (?, ?, ?, ?, ?, 'TODO', ?, ?)
    `, [
      userId,
      title.trim(),
      (description || '').trim(),
      formattedDateTime,
      category || '개인',
      is_top3 ? 1 : 0,
      is_important ? 1 : 0
    ]);

    req.session.successMsg = '새 일정이 성공적으로 등록되었습니다.';
    res.redirect('/');
  } catch (err) {
    console.error('Error creating schedule:', err);
    next(err);
  }
});

// Reschedule Schedule (Calendar Drag & Drop)
app.post('/schedules/:id/reschedule', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const { due_datetime } = req.body;

    const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    const sched = scheds[0];
    if (!sched) {
      return res.status(404).json({ error: '해당 일정을 찾을 수 없거나 수정 권한이 없습니다.' });
    }

    // Handle null / empty for undated schedule
    const isNoDeadline = (due_datetime === null || due_datetime === '' || due_datetime === 'null' || due_datetime === undefined);
    const formattedDateTime = isNoDeadline ? null : String(due_datetime).replace('T', ' ').slice(0, 16);

    const nowKST = getKoreanTimeString(0);
    let newStatus = sched.status;
    if (sched.status === 'EXPIRED') {
      if (isNoDeadline || (formattedDateTime && formattedDateTime > nowKST)) {
        newStatus = 'TODO';
      }
    } else if (sched.status !== 'DONE' && !isNoDeadline && formattedDateTime && formattedDateTime < nowKST) {
      newStatus = 'EXPIRED';
    }

    await pool.query(`UPDATE schedules SET due_datetime = ?, status = ? WHERE id = ? AND user_id = ?`,
      [formattedDateTime, newStatus, scheduleId, userId]);

    return res.json({
      success: true,
      id: scheduleId,
      new_due_datetime: formattedDateTime,
      new_status: newStatus,
      message: isNoDeadline ? '일정이 기한 미지정(상시)으로 전환되었습니다.' : '일정 일시가 변경되었습니다.'
    });
  } catch (err) {
    console.error('Error rescheduling schedule:', err);
    res.status(500).json({ error: '일정 일시 변경 중 오류가 발생했습니다.' });
  }
});

// Share personal schedule to team
app.post('/schedules/:id/share-to-team', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const teamId = parseInt(req.body.team_id, 10);

    if (!teamId) {
      req.session.errorMsg = '공유할 팀을 선택해 주세요.';
      return res.redirect('/');
    }

    // 1. Verify personal schedule ownership
    const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    const sched = scheds[0];
    if (!sched) {
      req.session.errorMsg = '해당 개인 일정을 찾을 수 없거나 권한이 없습니다.';
      return res.redirect('/');
    }

    // 2. Verify user is member of target team
    const [memberships] = await pool.query(`SELECT * FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    if (memberships.length === 0) {
      req.session.errorMsg = '해당 팀에 일정을 공유할 권한이 없습니다.';
      return res.redirect('/');
    }

    // 3. Copy to team_schedules
    const [result] = await pool.query(`
      INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
      VALUES (?, ?, ?, ?, ?, 'TODO')
    `, [
      teamId,
      userId,
      sched.title,
      sched.description || '',
      sched.due_datetime
    ]);

    // 4. Audit Log
    await logTeamScheduleAction(teamId, result.insertId, sched.title, userId, 'CREATED', `개인 일정(#${scheduleId})에서 복사 공유됨`);

    req.session.successMsg = '선택한 팀으로 일정이 성공적으로 공유되었습니다.';
    return res.redirect('/');
  } catch (err) {
    console.error('Error sharing schedule to team:', err);
    next(err);
  }
});

// Bulk Update Schedule Status (TODO / IN_PROGRESS / DONE)
app.post('/schedules/bulk-status', isAuthenticated, async (req, res, next) => {
  try {
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
    const [result] = await pool.query(`
      UPDATE schedules 
      SET status = ? 
      WHERE user_id = ? AND id IN (${placeholders})
    `, [status, userId, ...validIds]);

    req.session.successMsg = `${result.affectedRows}개의 일정이 [${status}] 상태로 변경되었습니다.`;
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true, count: result.affectedRows });
    }
    res.redirect('/');
  } catch (err) {
    console.error('Error bulk updating status:', err);
    next(err);
  }
});

// Bulk Delete Schedules
app.post('/schedules/bulk-delete', isAuthenticated, async (req, res, next) => {
  try {
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
    await pool.query(`
      DELETE FROM subtasks 
      WHERE schedule_id IN (
        SELECT id FROM (SELECT id FROM schedules WHERE user_id = ? AND id IN (${placeholders})) AS tmp
      )
    `, [userId, ...validIds]);

    // Delete schedules (strictly with user_id to prevent IDOR)
    const [result] = await pool.query(`
      DELETE FROM schedules 
      WHERE user_id = ? AND id IN (${placeholders})
    `, [userId, ...validIds]);

    req.session.successMsg = `${result.affectedRows}개의 일정이 일괄 삭제되었습니다.`;
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true, count: result.affectedRows });
    }
    res.redirect('/');
  } catch (err) {
    console.error('Error bulk deleting schedules:', err);
    next(err);
  }
});

// Update Schedule
app.post('/schedules/:id/update', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const { title, description, due_datetime, category, is_top3, is_important, status, no_deadline } = req.body;

    const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    const sched = scheds[0];
    if (!sched) {
      const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');
      if (isAsync) return res.status(404).json({ success: false, error: '일정을 찾을 수 없거나 권한이 없습니다.' });
      req.session.errorMsg = '일정을 찾을 수 없거나 권한이 없습니다.';
      return res.redirect('/');
    }

    const isNoDeadline = (no_deadline === 'on' || no_deadline === 'true' || no_deadline === true || !due_datetime || !due_datetime.trim());
    const formattedDateTime = isNoDeadline ? null : due_datetime.replace('T', ' ').slice(0, 16);

    const nowKST = getKoreanTimeString(0);
    let effectiveStatus = status;
    if (!effectiveStatus || !['TODO', 'IN_PROGRESS', 'DONE', 'EXPIRED'].includes(effectiveStatus)) {
      effectiveStatus = sched.status;
    }

    // Auto-restore EXPIRED schedule to TODO if deadline changed to future or no deadline
    if (sched.status === 'EXPIRED') {
      if (isNoDeadline || (formattedDateTime && formattedDateTime > nowKST)) {
        if (effectiveStatus === 'EXPIRED') {
          effectiveStatus = 'TODO';
        }
      }
    } else if (effectiveStatus !== 'DONE' && !isNoDeadline && formattedDateTime && formattedDateTime < nowKST) {
      effectiveStatus = 'EXPIRED';
    }

    const [result] = await pool.query(`
      UPDATE schedules 
      SET title = ?, description = ?, due_datetime = ?, category = ?, is_top3 = ?, is_important = ?, status = ?
      WHERE id = ? AND user_id = ?
    `, [
      (title || '').trim(),
      (description || '').trim(),
      formattedDateTime,
      category || '개인',
      is_top3 ? 1 : 0,
      is_important ? 1 : 0,
      effectiveStatus,
      scheduleId,
      userId
    ]);

    // Reorder subtasks if subtask_ids submitted
    const subtaskIds = req.body['subtask_ids[]'] || req.body.subtask_ids;
    if (subtaskIds) {
      const ids = Array.isArray(subtaskIds) ? subtaskIds : [subtaskIds];
      for (let idx = 0; idx < ids.length; idx++) {
        await pool.query(`UPDATE subtasks SET sort_order = ? WHERE id = ? AND schedule_id = ?`,
          [idx, parseInt(ids[idx], 10), scheduleId]);
      }
    }

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');
    if (isAsync) {
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: '일정을 찾을 수 없거나 권한이 없습니다.' });
      }
      const [updatedScheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
      const updated = updatedScheds[0];
      const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [scheduleId]);
      const stats = await getUserScheduleStats(userId);
      return res.json({ success: true, schedule: { ...updated, subtasks }, stats });
    }

    if (result.affectedRows === 0) {
      req.session.errorMsg = '일정을 찾을 수 없거나 권한이 없습니다.';
    } else {
      req.session.successMsg = '일정이 수정되었습니다.';
    }
    res.redirect('/');
  } catch (err) {
    console.error('Error updating schedule:', err);
    next(err);
  }
});

// Reorder subtasks endpoint
app.post('/schedules/:id/subtasks/reorder', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const [scheds] = await pool.query(`SELECT id FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    if (scheds.length === 0) return res.status(404).json({ success: false, error: '권한이 없습니다.' });

    const subtaskIds = req.body.subtask_ids || req.body['subtask_ids[]'];
    if (subtaskIds) {
      const ids = Array.isArray(subtaskIds) ? subtaskIds : [subtaskIds];
      for (let idx = 0; idx < ids.length; idx++) {
        await pool.query(`UPDATE subtasks SET sort_order = ? WHERE id = ? AND schedule_id = ?`,
          [idx, parseInt(ids[idx], 10), scheduleId]);
      }
    }
    const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [scheduleId]);
    res.json({ success: true, subtasks });
  } catch (err) {
    console.error('Error reordering subtasks:', err);
    res.status(500).json({ success: false, error: '하위 작업 순서 변경 중 오류가 발생했습니다.' });
  }
});

// Update Schedule Status (TODO / IN_PROGRESS / DONE / EXPIRED)
app.post('/schedules/:id/status', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const { status } = req.body;

    if (!['TODO', 'IN_PROGRESS', 'DONE', 'EXPIRED'].includes(status)) {
      return res.status(400).json({ error: '유효하지 않은 상태값입니다.' });
    }

    const [result] = await pool.query(`
      UPDATE schedules SET status = ? WHERE id = ? AND user_id = ?
    `, [status, scheduleId, userId]);

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');
    if (isAsync) {
      const stats = await getUserScheduleStats(userId);
      return res.json({ success: result.affectedRows > 0, status, stats });
    }
    res.redirect('/');
  } catch (err) {
    console.error('Error updating schedule status:', err);
    next(err);
  }
});

// Toggle Top 3 Priority
app.post('/schedules/:id/top3', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    const userId = req.session.userId;

    const [currentRows] = await pool.query(`SELECT is_top3 FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    const current = currentRows[0];
    if (current && current.is_top3 === 0) {
      const [pCount] = await pool.query(`SELECT COUNT(*) as count FROM schedules WHERE user_id = ? AND is_top3 = 1`, [userId]);
      const [tCount] = await pool.query(`SELECT COUNT(*) as count FROM user_top3_team_schedules WHERE user_id = ?`, [userId]);
      if (pCount[0].count + tCount[0].count >= 3) {
        req.session.errorMsg = '오늘의 핵심 목표는 최대 3개까지만 지정할 수 있습니다.';
        return res.redirect('/');
      }
    }

    await pool.query(`
      UPDATE schedules 
      SET is_top3 = CASE WHEN is_top3 = 1 THEN 0 ELSE 1 END
      WHERE id = ? AND user_id = ?
    `, [scheduleId, userId]);

    res.redirect('/');
  } catch (err) {
    console.error('Error toggling schedule top3:', err);
    next(err);
  }
});

// POST /api/top3/add: 드래그 앤 드롭으로 Top 3 등록
app.post('/api/top3/add', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { type, id } = req.body;
    const targetId = parseInt(id, 10);

    if (!type || !targetId || isNaN(targetId)) {
      return res.status(400).json({ success: false, error: '유효한 일정 정보가 필요합니다.' });
    }

    const [pCount] = await pool.query(`SELECT COUNT(*) as count FROM schedules WHERE user_id = ? AND is_top3 = 1`, [userId]);
    const [tCount] = await pool.query(`SELECT COUNT(*) as count FROM user_top3_team_schedules WHERE user_id = ?`, [userId]);
    const totalTop3 = pCount[0].count + tCount[0].count;

    if (type === 'PERSONAL') {
      const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [targetId, userId]);
      const sched = scheds[0];
      if (!sched) {
        return res.status(404).json({ success: false, error: '해당 개인 일정을 찾을 수 없거나 권한이 없습니다.' });
      }
      if (sched.is_top3 === 1) {
        return res.json({ success: true, message: '이미 Top 3 핵심 목표로 등록되어 있습니다.' });
      }
      if (totalTop3 >= 3) {
        return res.status(400).json({ success: false, error: '오늘의 핵심 목표는 최대 3개까지만 지정할 수 있습니다.' });
      }
      await pool.query(`UPDATE schedules SET is_top3 = 1 WHERE id = ? AND user_id = ?`, [targetId, userId]);
      return res.json({ success: true, message: 'Top 3 핵심 목표로 등록되었습니다.' });

    } else if (type === 'TEAM') {
      const [scheds] = await pool.query(`
        SELECT ts.* FROM team_schedules ts
        JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ?
        WHERE ts.id = ?
      `, [userId, targetId]);
      const sched = scheds[0];

      if (!sched) {
        return res.status(404).json({ success: false, error: '소속 팀 일정을 찾을 수 없거나 접근 권한이 없습니다.' });
      }

      const [alreadyRows] = await pool.query(`SELECT id FROM user_top3_team_schedules WHERE user_id = ? AND team_schedule_id = ?`, [userId, targetId]);
      if (alreadyRows.length > 0) {
        return res.json({ success: true, message: '이미 Top 3 핵심 목표로 등록되어 있습니다.' });
      }
      if (totalTop3 >= 3) {
        return res.status(400).json({ success: false, error: '오늘의 핵심 목표는 최대 3개까지만 지정할 수 있습니다.' });
      }

      await pool.query(`INSERT INTO user_top3_team_schedules (user_id, team_schedule_id) VALUES (?, ?)`, [userId, targetId]);
      return res.json({ success: true, message: '소속 팀 일정이 Top 3 핵심 목표로 등록되었습니다.' });

    } else {
      return res.status(400).json({ success: false, error: '유효하지 않은 일정 타입입니다.' });
    }
  } catch (err) {
    console.error('Error adding top3:', err);
    res.status(500).json({ success: false, error: 'Top 3 등록 중 오류가 발생했습니다.' });
  }
});

// POST /api/top3/remove: 바깥 드래그 또는 버튼 클릭으로 Top 3 해제
app.post('/api/top3/remove', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { type, id } = req.body;
    const targetId = parseInt(id, 10);

    if (!type || !targetId || isNaN(targetId)) {
      return res.status(400).json({ success: false, error: '유효한 일정 정보가 필요합니다.' });
    }

    if (type === 'PERSONAL') {
      const [result] = await pool.query(`UPDATE schedules SET is_top3 = 0 WHERE id = ? AND user_id = ?`, [targetId, userId]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, error: '해당 일정을 찾을 수 없거나 권한이 없습니다.' });
      }
      return res.json({ success: true, message: 'Top 3 목표에서 해제되었습니다.' });

    } else if (type === 'TEAM') {
      await pool.query(`DELETE FROM user_top3_team_schedules WHERE user_id = ? AND team_schedule_id = ?`, [userId, targetId]);
      return res.json({ success: true, message: 'Top 3 목표에서 해제되었습니다.' });

    } else {
      return res.status(400).json({ success: false, error: '유효하지 않은 일정 타입입니다.' });
    }
  } catch (err) {
    console.error('Error removing top3:', err);
    res.status(500).json({ success: false, error: 'Top 3 해제 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// Dashboard Widgets & Layout APIs (modules.md)
// ==========================================

// POST /api/dashboard/widgets: 위젯 켜기/끄기 설정 및 기본 프리셋 리셋
app.post('/api/dashboard/widgets', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { reset, widgets } = req.body;
    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);

    if (reset) {
      await pool.query(`UPDATE users SET dashboard_layout = NULL WHERE id = ?`, [userId]);
      const resetLayout = getEffectiveDashboardLayout(null, customWidgets);
      return res.json({
        success: true,
        message: '기본 프리셋으로 초기화되었습니다.',
        layout: resetLayout
      });
    }

    const [users] = await pool.query(`SELECT dashboard_layout FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    const currentLayout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);

    let maxY = 0;
    currentLayout.forEach(item => {
      if (item.enabled) {
        const bottom = (item.y || 0) + (item.h || 2);
        if (bottom > maxY) maxY = bottom;
      }
    });

    const updatedLayout = currentLayout.map(item => {
      let isEnabled = item.enabled;
      if (widgets && widgets[item.id] !== undefined) {
        isEnabled = (widgets[item.id] === true || widgets[item.id] === 1 || widgets[item.id] === 'true');
      }
      let x = item.x;
      let y = item.y;
      if (!item.enabled && isEnabled) {
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

    await pool.query(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(updatedLayout), userId]);
    return res.json({
      success: true,
      message: '위젯 설정이 저장되었습니다.',
      layout: updatedLayout
    });
  } catch (err) {
    console.error('Error saving dashboard widgets:', err);
    res.status(500).json({ success: false, error: '위젯 설정 저장 중 오류가 발생했습니다.' });
  }
});

// POST /api/dashboard/layout: 그리드스택 드래그/리사이즈 좌표 자동 저장
app.post('/api/dashboard/layout', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { layout } = req.body;

    if (!Array.isArray(layout)) {
      return res.status(400).json({ success: false, message: '유효한 레이아웃 데이터가 아닙니다.' });
    }

    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);
    const [users] = await pool.query(`SELECT dashboard_layout FROM users WHERE id = ?`, [userId]);
    const user = users[0];
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

    await pool.query(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(updatedLayout), userId]);
    return res.json({ success: true, message: '레이아웃이 저장되었습니다.' });
  } catch (err) {
    console.error('Error saving dashboard layout:', err);
    res.status(500).json({ success: false, error: '레이아웃 저장 중 오류가 발생했습니다.' });
  }
});

// POST /api/dashboard/memo: 빠른 메모장 위젯 디바운스 자동 저장
app.post('/api/dashboard/memo', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const memo = typeof req.body.memo === 'string' ? req.body.memo : '';

    await pool.query(`UPDATE users SET quick_memo = ? WHERE id = ?`, [memo, userId]);
    return res.json({ success: true, message: '메모가 저장되었습니다.' });
  } catch (err) {
    console.error('Error saving quick memo:', err);
    res.status(500).json({ success: false, error: '메모 저장 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// Custom Widget Builder & Market APIs (moduleplus.md)
// ==========================================

// POST /api/custom-widgets: 새 커스텀 위젯 생성
app.post('/api/custom-widgets', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { title, description, html_code, css_code, js_code, default_w, default_h } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: '위젯 제목을 입력해 주세요.' });
    }

    const w = Math.max(1, Math.min(12, parseInt(default_w, 10) || 4));
    const h = Math.max(1, Math.min(20, parseInt(default_h, 10) || 3));

    const [info] = await pool.query(`
      INSERT INTO user_custom_widgets (user_id, title, description, html_code, css_code, js_code, default_w, default_h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      title.trim(),
      (description || '').trim(),
      html_code || '',
      css_code || '',
      js_code || '',
      w,
      h
    ]);

    const [newWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE id = ?`, [info.insertId]);
    const newWidget = newWidgets[0];

    // Automatically add into dashboard_layout as enabled
    const [users] = await pool.query(`SELECT dashboard_layout FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);
    const layout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);
    await pool.query(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(layout), userId]);

    return res.json({ success: true, message: '커스텀 위젯이 성공적으로 생성되었습니다.', widget: newWidget });
  } catch (err) {
    console.error('Error creating custom widget:', err);
    res.status(500).json({ success: false, message: '위젯 생성 중 오류가 발생했습니다.' });
  }
});

// POST /api/custom-widgets/:id/update: 기존 커스텀 위젯 수정 (소유권 검증)
app.post('/api/custom-widgets/:id/update', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const widgetId = req.params.id;
    const { title, description, html_code, css_code, js_code, default_w, default_h } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: '위젯 제목을 입력해 주세요.' });
    }

    const [existingWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE id = ? AND user_id = ?`, [widgetId, userId]);
    const existing = existingWidgets[0];
    if (!existing) {
      return res.status(404).json({ success: false, message: '위젯을 찾을 수 없거나 권한이 없습니다.' });
    }

    const w = Math.max(1, Math.min(12, parseInt(default_w, 10) || existing.default_w || 4));
    const h = Math.max(1, Math.min(20, parseInt(default_h, 10) || existing.default_h || 3));

    await pool.query(`
      UPDATE user_custom_widgets
      SET title = ?, description = ?, html_code = ?, css_code = ?, js_code = ?, default_w = ?, default_h = ?
      WHERE id = ? AND user_id = ?
    `, [
      title.trim(),
      (description || '').trim(),
      html_code || '',
      css_code || '',
      js_code || '',
      w,
      h,
      widgetId,
      userId
    ]);

    const [updatedWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE id = ?`, [widgetId]);
    return res.json({ success: true, message: '위젯이 성공적으로 수정되었습니다.', widget: updatedWidgets[0] });
  } catch (err) {
    console.error('Error updating custom widget:', err);
    res.status(500).json({ success: false, message: '위젯 수정 중 오류가 발생했습니다.' });
  }
});

// POST /api/custom-widgets/:id/delete: 커스텀 위젯 삭제 및 dashboard_layout에서 자동 제거
app.post('/api/custom-widgets/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const widgetId = req.params.id;

    const [existingWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE id = ? AND user_id = ?`, [widgetId, userId]);
    if (existingWidgets.length === 0) {
      return res.status(404).json({ success: false, message: '위젯을 찾을 수 없거나 권한이 없습니다.' });
    }

    await pool.query(`DELETE FROM user_custom_widgets WHERE id = ? AND user_id = ?`, [widgetId, userId]);

    // Automatically remove custom_{id} from dashboard_layout JSON
    const [users] = await pool.query(`SELECT dashboard_layout FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    if (user && user.dashboard_layout) {
      try {
        const parsed = JSON.parse(user.dashboard_layout);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter(item => item && item.id !== `custom_${widgetId}`);
          await pool.query(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(filtered), userId]);
        }
      } catch (e) {}
    }

    return res.json({ success: true, message: '위젯이 삭제되었습니다.' });
  } catch (err) {
    console.error('Error deleting custom widget:', err);
    res.status(500).json({ success: false, message: '위젯 삭제 중 오류가 발생했습니다.' });
  }
});

// GET /api/custom-widgets/:id/export: 공유 가능한 표준 JSON 포맷 반환
app.get('/api/custom-widgets/:id/export', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const widgetId = req.params.id;

    const [widgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE id = ? AND user_id = ?`, [widgetId, userId]);
    const widget = widgets[0];
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
  } catch (err) {
    console.error('Error exporting custom widget:', err);
    res.status(500).json({ success: false, message: '위젯 내보내기 중 오류가 발생했습니다.' });
  }
});

// POST /api/custom-widgets/import: 전달받은 JSON 문자열 검증 및 복제 등록 (크기 50KB 이하)
app.post('/api/custom-widgets/import', isAuthenticated, async (req, res, next) => {
  try {
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

    const [info] = await pool.query(`
      INSERT INTO user_custom_widgets (user_id, title, description, html_code, css_code, js_code, default_w, default_h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      title,
      description,
      html_code,
      css_code,
      js_code,
      default_w,
      default_h
    ]);

    const [newWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE id = ?`, [info.insertId]);
    const newWidget = newWidgets[0];

    // Add into dashboard_layout as enabled
    const [users] = await pool.query(`SELECT dashboard_layout FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);
    const layout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);
    await pool.query(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(layout), userId]);

    return res.json({ success: true, message: '위젯을 성공적으로 가져왔습니다.', widget: newWidget });
  } catch (err) {
    console.error('Error importing custom widget:', err);
    res.status(500).json({ success: false, message: '위젯 가져오기 중 오류가 발생했습니다.' });
  }
});

// POST /api/custom-widgets/:id/toggle: 커스텀 위젯 대시보드 표시 토글
app.post('/api/custom-widgets/:id/toggle', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const widgetId = req.params.id;
    const enabled = (req.body.enabled === true || req.body.enabled === 1 || req.body.enabled === 'true');

    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);
    const [users] = await pool.query(`SELECT dashboard_layout FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    const layout = getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets);

    const cleanId = String(widgetId).replace(/^custom_/, '');
    const targetId = `custom_${cleanId}`;
    let found = false;
    layout.forEach(item => {
      if (item.id === targetId) {
        item.enabled = enabled;
        found = true;
      }
    });

    if (!found) {
      const cw = customWidgets.find(w => String(w.id) === cleanId);
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

    await pool.query(`UPDATE users SET dashboard_layout = ? WHERE id = ?`, [JSON.stringify(layout), userId]);
    return res.json({ success: true, message: '위젯 표시 상태가 변경되었습니다.', enabled });
  } catch (err) {
    console.error('Error toggling custom widget:', err);
    res.status(500).json({ success: false, message: '위젯 상태 변경 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// Notifications & Team Invitations APIs (second.md 3번)
// ==========================================
// POST /api/notifications/read-all: 모든 알림 읽음 처리
app.post('/api/notifications/read-all', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    await pool.query(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
    return res.json({ success: true, message: '모든 알림을 읽음 처리했습니다.' });
  } catch (err) {
    console.error('Failed to mark notifications read:', err);
    return res.status(500).json({ success: false, error: '알림 처리 중 오류가 발생했습니다.' });
  }
});

// POST /api/invitations/:id/respond: 팀 초대 수락 또는 거절
app.post('/api/invitations/:id/respond', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const invId = parseInt(req.params.id, 10);
    const { action } = req.body; // 'ACCEPT' | 'DECLINE'

    if (!['ACCEPT', 'DECLINE'].includes(action)) {
      return res.status(400).json({ success: false, error: '유효하지 않은 응답입니다.' });
    }

    const [invs] = await pool.query(`SELECT * FROM team_invitations WHERE id = ? AND invitee_id = ? AND status = 'PENDING'`, [invId, userId]);
    const inv = invs[0];
    if (!inv) {
      return res.status(404).json({ success: false, error: '대기 중인 초대장을 찾을 수 없습니다.' });
    }

    const [teams] = await pool.query(`SELECT * FROM teams WHERE id = ?`, [inv.team_id]);
    const team = teams[0];
    const [mes] = await pool.query(`SELECT name, username FROM users WHERE id = ?`, [userId]);
    const me = mes[0];

    if (action === 'ACCEPT') {
      if (!team) {
        await pool.query(`UPDATE team_invitations SET status = 'DECLINED' WHERE id = ?`, [invId]);
        return res.status(404).json({ success: false, error: '해당 팀이 더 이상 존재하지 않습니다.' });
      }

      // Mark invitation accepted
      await pool.query(`UPDATE team_invitations SET status = 'ACCEPTED' WHERE id = ?`, [invId]);

      // Add to team_members
      await pool.query(`
        INSERT IGNORE INTO team_members (team_id, user_id, position, role)
        VALUES (?, ?, '팀원', 'MEMBER')
      `, [inv.team_id, userId]);

      // Notify inviter
      const acceptMsg = `[${team.name}] ${me ? me.name : '팀원'}(@${me ? me.username : ''})님이 팀 초대를 수락하여 팀원으로 합류했습니다!`;
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link_url)
        VALUES (?, 'TEAM_INVITE', ?, ?)
      `, [inv.inviter_id, acceptMsg, `/teams?teamId=${inv.team_id}`]);

      return res.json({
        success: true,
        message: `"${team.name}" 팀에 성공적으로 합류했습니다!`,
        teamId: inv.team_id
      });
    } else {
      // DECLINE
      await pool.query(`UPDATE team_invitations SET status = 'DECLINED' WHERE id = ?`, [invId]);
      return res.json({ success: true, message: '팀 초대를 거절했습니다.' });
    }
  } catch (err) {
    console.error('Error responding to invitation:', err);
    res.status(500).json({ success: false, error: '초대 응답 처리 중 오류가 발생했습니다.' });
  }
});

// Delete Schedule
app.post('/schedules/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    await pool.query(`DELETE FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    req.session.successMsg = '일정이 삭제되었습니다.';
    res.redirect('/');
  } catch (err) {
    console.error('Error deleting schedule:', err);
    next(err);
  }
});

// Subtask Routes (checklist.md)
// Add Subtask
app.post('/schedules/:id/subtasks', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const { title } = req.body;

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');

    // Ownership verification (IDOR Defense)
    const [scheds] = await pool.query(`SELECT id FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    if (scheds.length === 0) {
      if (isAsync) return res.status(403).json({ success: false, error: '권한이 없습니다.' });
      req.session.errorMsg = '권한이 없습니다.';
      return res.redirect('/');
    }

    if (!title || !title.trim()) {
      if (isAsync) return res.status(400).json({ success: false, error: '하위 작업 내용을 입력해 주세요.' });
      req.session.errorMsg = '하위 작업 내용을 입력해 주세요.';
      return res.redirect('/');
    }

    const [result] = await pool.query(`INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, 0)`, [scheduleId, title.trim()]);
    const [newSubtasks] = await pool.query(`SELECT * FROM subtasks WHERE id = ?`, [result.insertId]);
    const newSubtask = newSubtasks[0];

    const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [scheduleId]);
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
  } catch (err) {
    console.error('Error adding subtask:', err);
    next(err);
  }
});

// AI Auto Split Subtasks (Gemini 2.5 Flash + Fallback)
app.post('/schedules/:id/subtasks/ai-split', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;

    const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    const sched = scheds[0];
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

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of steps) {
        await conn.query(`INSERT INTO subtasks (schedule_id, title, is_done) VALUES (?, ?, 0)`, [scheduleId, String(item)]);
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    req.session.successMsg = `"${sched.title}"의 실행 단계 ${steps.length}개를 자동 분할하여 등록했습니다!`;
    res.redirect('/');
  } catch (err) {
    console.error('Error in AI subtasks split:', err);
    next(err);
  }
});

// Toggle Subtask (checklist.md)
app.post('/subtasks/:id/toggle', isAuthenticated, async (req, res, next) => {
  try {
    const subtaskId = req.params.id;
    const userId = req.session.userId;

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');

    // Ownership verification via JOIN (IDOR Defense)
    const [rows] = await pool.query(`
      SELECT subtasks.id, subtasks.is_done, schedules.id as schedule_id
      FROM subtasks
      JOIN schedules ON schedules.id = subtasks.schedule_id
      WHERE subtasks.id = ? AND schedules.user_id = ?
    `, [subtaskId, userId]);
    const row = rows[0];

    if (!row) {
      if (isAsync) {
        return res.status(403).json({ success: false, error: '권한이 없습니다.' });
      }
      return res.redirect('/');
    }

    const newStatus = row.is_done === 1 ? 0 : 1;
    await pool.query(`UPDATE subtasks SET is_done = ? WHERE id = ?`, [newStatus, subtaskId]);

    const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [row.schedule_id]);
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
  } catch (err) {
    console.error('Error toggling subtask:', err);
    next(err);
  }
});

// Delete Subtask (checklist.md)
app.post('/subtasks/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const subtaskId = req.params.id;
    const userId = req.session.userId;

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json') || req.headers['content-type']?.includes('application/json');

    // Ownership verification via JOIN (IDOR Defense)
    const [rows] = await pool.query(`
      SELECT subtasks.id, schedules.id as schedule_id
      FROM subtasks
      JOIN schedules ON schedules.id = subtasks.schedule_id
      WHERE subtasks.id = ? AND schedules.user_id = ?
    `, [subtaskId, userId]);
    const row = rows[0];

    if (!row) {
      if (isAsync) {
        return res.status(403).json({ success: false, error: '권한이 없습니다.' });
      }
      return res.redirect('/');
    }

    await pool.query(`DELETE FROM subtasks WHERE id = ?`, [subtaskId]);

    const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [row.schedule_id]);
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
  } catch (err) {
    console.error('Error deleting subtask:', err);
    next(err);
  }
});

// Focus Complete (Pomodoro Recording & Telegram Notification)
app.post('/schedules/:id/focus', isAuthenticated, async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const userId = req.session.userId;
    const minutes = parseInt(req.body.minutes, 10) || 25;

    const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [scheduleId, userId]);
    const sched = scheds[0];
    if (!sched) {
      return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    }

    // Update focus minutes
    await pool.query(`UPDATE schedules SET focus_minutes = focus_minutes + ? WHERE id = ?`, [minutes, scheduleId]);

    // Send Telegram focus completion notification if user has linked Telegram
    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    if (user && user.telegram_chat_id) {
      const focusMsg = `🎯 [집중 완료 알림]\n"${sched.title}" 일정에 ${minutes}분간 완전히 몰입하셨습니다!\n오늘도 멋진 생산성을 달성하셨네요. 잠시 스트레칭을 하며 휴식하세요. ☕`;
      await sendTelegramMessage(user.telegram_chat_id, focusMsg, userId, 'FOCUS_COMPLETE');
    }

    return res.json({
      success: true,
      added_minutes: minutes,
      total_focus: sched.focus_minutes + minutes
    });
  } catch (err) {
    console.error('Error saving focus time:', err);
    res.status(500).json({ error: '집중 시간 저장 중 오류가 발생했습니다.' });
  }
});

// Complete Focus Session without linked schedule (General Session)
app.post('/focus/complete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const minutes = parseInt(req.body.minutes, 10) || 25;
    const title = (req.body.title || '일반 집중 세션').trim();

    // Send Telegram focus completion notification if user has linked Telegram
    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    if (user && user.telegram_chat_id) {
      const focusMsg = `🎯 [집중 완료 알림]\n"${title}"에 ${minutes}분간 완전히 몰입하셨습니다!\n오늘도 멋진 생산성을 달성하셨네요. 잠시 스트레칭을 하며 휴식하세요. ☕`;
      await sendTelegramMessage(user.telegram_chat_id, focusMsg, userId, 'FOCUS_COMPLETE');
    }

    return res.json({
      success: true,
      added_minutes: minutes,
      title
    });
  } catch (err) {
    console.error('Error completing focus session:', err);
    res.status(500).json({ error: '집중 완료 처리 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// 9. Telegram Integration User Routes
// ==========================================

// Generate 6-digit Link Code
app.post('/telegram/generate-code', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await pool.query(`UPDATE users SET telegram_link_code = ? WHERE id = ?`, [newCode, userId]);
    req.session.successMsg = `새 텔레그램 연동 코드가 발급되었습니다: ${newCode}`;
    res.redirect(req.headers.referer || '/');
  } catch (err) {
    console.error('Error generating telegram code:', err);
    next(err);
  }
});

// Immediate Test Rich Briefing
app.post('/telegram/test-alert', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { schedule_id } = req.body;

    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    if (!user || !user.telegram_chat_id) {
      req.session.errorMsg = '먼저 텔레그램 연동을 완료해 주세요. (우측 패널 또는 마이페이지 참조)';
      return res.redirect(req.headers.referer || '/');
    }

    let schedule = null;
    if (schedule_id) {
      const [scheds] = await pool.query(`SELECT * FROM schedules WHERE id = ? AND user_id = ?`, [schedule_id, userId]);
      schedule = scheds[0];
    }
    if (!schedule) {
      const [scheds] = await pool.query(`
        SELECT * FROM schedules 
        WHERE user_id = ? AND is_important = 1 
        ORDER BY due_datetime ASC 
        LIMIT 1
      `, [userId]);
      schedule = scheds[0];
    }
    if (!schedule) {
      const [scheds] = await pool.query(`SELECT * FROM schedules WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [userId]);
      schedule = scheds[0];
    }

    if (!schedule) {
      req.session.errorMsg = '브리핑을 테스트할 일정이 없습니다. 일정을 먼저 등록해 주세요.';
      return res.redirect(req.headers.referer || '/');
    }

    const [subtasks] = await pool.query(`SELECT * FROM subtasks WHERE schedule_id = ? ORDER BY sort_order ASC, id ASC`, [schedule.id]);
    const briefing = formatScheduleBriefing(schedule, subtasks);

    const ok = await sendTelegramMessage(user.telegram_chat_id, briefing, userId, 'TEST_ALERT');
    if (ok) {
      req.session.successMsg = `텔레그램으로 "[${schedule.title}]" 리치 브리핑 테스트를 발송했습니다!`;
    } else {
      req.session.errorMsg = '텔레그램 발송에 실패했습니다. 관리자 설정의 봇 토큰을 확인해 주세요.';
    }

    res.redirect(req.headers.referer || '/');
  } catch (err) {
    console.error('Error in test alert:', err);
    next(err);
  }
});

// ==========================================
// 9-1. Team Workspace Routes
// ==========================================

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/teams/recent-updates: 내가 속한 팀들의 다른 팀원 활동 최근 업데이트 조회
app.get('/api/teams/recent-updates', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;

    const [myTeamRows] = await pool.query(`SELECT team_id FROM team_members WHERE user_id = ?`, [userId]);
    if (myTeamRows.length === 0) {
      return res.json({ latestId: null, updates: [] });
    }

    const teamIds = myTeamRows.map(r => r.team_id);
    const placeholders = teamIds.map(() => '?').join(',');

    // 1. 최근 등록된 팀 일정 (본인 제외)
    const [schedUpdates] = await pool.query(`
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
    `, [...teamIds, userId]);

    // 2. 최근 등록된 팀 특이사항/공지 (본인 제외)
    const [noteUpdates] = await pool.query(`
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
    `, [...teamIds, userId]);

    const allUpdates = [...schedUpdates, ...noteUpdates].sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }).slice(0, 10);

    const latestId = allUpdates.length > 0 ? `${allUpdates[0].type}_${allUpdates[0].id}_${allUpdates[0].createdAt}` : null;

    res.json({
      latestId,
      updates: allUpdates
    });
  } catch (err) {
    console.error('Error fetching recent updates:', err);
    res.status(500).json({ latestId: null, updates: [] });
  }
});

// GET /teams: 내가 속한 팀 목록 및 특정 팀 대시보드
app.get('/teams', isAuthenticated, requireMemberAccount, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];

    let teamId = req.query.teamId ? parseInt(req.query.teamId, 10) : null;
    if (teamId) {
      await ensureTeamLeader(teamId);
    }

    let [myTeams] = await pool.query(`
      SELECT t.*, tm.position, tm.role, tm.sort_order,
             (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = ?
      ORDER BY tm.sort_order ASC, tm.joined_at ASC
    `, [userId]);

    if (!teamId && myTeams.length > 0) {
      teamId = myTeams[0].id;
      const promoted = await ensureTeamLeader(teamId);
      if (promoted) {
        const [refreshed] = await pool.query(`
          SELECT t.*, tm.position, tm.role, tm.sort_order,
                 (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
          FROM teams t
          JOIN team_members tm ON tm.team_id = t.id
          WHERE tm.user_id = ?
          ORDER BY tm.sort_order ASC, tm.joined_at ASC
        `, [userId]);
        myTeams = refreshed;
      }
    }

    let currentTeam = null;
    let myMembership = null;
    let members = [];
    let schedules = [];
    let notes = [];
    let scheduleLogs = [];

    if (teamId) {
      await ensureTeamLeader(teamId);

      const [memberships] = await pool.query(`
        SELECT * FROM team_members 
        WHERE team_id = ? AND user_id = ?
      `, [teamId, userId]);
      myMembership = memberships[0];

      if (!myMembership) {
        req.session.errorMsg = '해당 팀에 접근할 권한이 없거나 가입되어 있지 않습니다.';
        return res.redirect('/teams');
      }

      const [currentTeams] = await pool.query(`
        SELECT t.*, COALESCE(u.name, '알 수 없음') as owner_name, COALESCE(u.username, '') as owner_username
        FROM teams t
        LEFT JOIN users u ON u.id = t.owner_id
        WHERE t.id = ?
      `, [teamId]);
      currentTeam = currentTeams[0];

      const [memberRows] = await pool.query(`
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
      `, [teamId]);
      members = memberRows;

      const [userNotes] = await pool.query(`
        SELECT id, title, linked_type, linked_schedule_id 
        FROM user_notes 
        WHERE user_id = ?
      `, [userId]);

      const [schedRows] = await pool.query(`
        SELECT ts.*, u.name as author_name, tm.position as author_position, tm.role as author_role
        FROM team_schedules ts
        LEFT JOIN users u ON u.id = ts.author_id
        LEFT JOIN team_members tm ON tm.team_id = ts.team_id AND tm.user_id = ts.author_id
        WHERE ts.team_id = ?
        ORDER BY ts.due_datetime IS NULL ASC, ts.due_datetime ASC
      `, [teamId]);

      schedules = schedRows.map(sched => ({
        ...sched,
        linked_notes: userNotes.filter(n => n.linked_type === 'TEAM' && n.linked_schedule_id === sched.id)
      }));

      const [noteRows] = await pool.query(`
        SELECT tn.*, u.name as author_name, tm.position as author_position, tm.role as author_role
        FROM team_notes tn
        LEFT JOIN users u ON u.id = tn.author_id
        LEFT JOIN team_members tm ON tm.team_id = tn.team_id AND tm.user_id = tn.author_id
        WHERE tn.team_id = ?
        ORDER BY tn.is_pinned DESC, tn.created_at DESC
      `, [teamId]);
      notes = noteRows;

      if (myMembership && (myMembership.role === 'LEADER' || myMembership.role === 'MANAGER')) {
        const [logRows] = await pool.query(`
          SELECT tsl.*, u.name as editor_name, COALESCE(tm.position, '팀원') as editor_position
          FROM team_schedule_logs tsl
          JOIN users u ON u.id = tsl.editor_id
          LEFT JOIN team_members tm ON tm.team_id = tsl.team_id AND tm.user_id = tsl.editor_id
          WHERE tsl.team_id = ?
          ORDER BY tsl.created_at DESC
          LIMIT 50
        `, [teamId]);
        scheduleLogs = logRows;
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
  } catch (err) {
    console.error('Error in GET /teams:', err);
    next(err);
  }
});

// POST /teams/create: 새 프로젝트 팀 생성
app.post('/teams/create', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      req.session.errorMsg = '팀명을 입력해 주세요.';
      return res.redirect('/teams');
    }

    let inviteCode = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      inviteCode = generateInviteCode();
      const [existing] = await pool.query(`SELECT id FROM teams WHERE invite_code = ?`, [inviteCode]);
      if (existing.length === 0) isUnique = true;
      attempts++;
    }

    const [result] = await pool.query(`
      INSERT INTO teams (name, description, invite_code, owner_id)
      VALUES (?, ?, ?, ?)
    `, [name.trim(), description ? description.trim() : '', inviteCode, userId]);
    const newTeamId = result.insertId;

    await pool.query(`
      INSERT INTO team_members (team_id, user_id, position, role)
      VALUES (?, ?, '팀장', 'LEADER')
    `, [newTeamId, userId]);

    req.session.successMsg = `새 프로젝트 팀 "${name.trim()}"이(가) 성공적으로 생성되었습니다. (초대 코드: ${inviteCode})`;
    res.redirect(`/teams?teamId=${newTeamId}`);
  } catch (err) {
    console.error('Error creating team:', err);
    next(err);
  }
});

// POST /teams/join: 초대 코드로 팀 참여
app.post('/teams/join', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { invite_code } = req.body;

    if (!invite_code || !invite_code.trim()) {
      req.session.errorMsg = '초대 코드를 입력해 주세요.';
      return res.redirect('/teams');
    }

    const code = invite_code.trim().toUpperCase();
    const [teams] = await pool.query(`SELECT * FROM teams WHERE UPPER(invite_code) = ?`, [code]);
    const team = teams[0];

    if (!team) {
      req.session.errorMsg = '유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.';
      return res.redirect('/teams');
    }

    const [existingMembers] = await pool.query(`
      SELECT id FROM team_members WHERE team_id = ? AND user_id = ?
    `, [team.id, userId]);

    if (existingMembers.length > 0) {
      req.session.errorMsg = `이미 "${team.name}" 팀에 가입되어 있습니다.`;
      return res.redirect(`/teams?teamId=${team.id}`);
    }

    await pool.query(`
      INSERT INTO team_members (team_id, user_id, position, role)
      VALUES (?, ?, '팀원', 'MEMBER')
    `, [team.id, userId]);

    req.session.successMsg = `"${team.name}" 팀에 성공적으로 합류했습니다!`;
    res.redirect(`/teams?teamId=${team.id}`);
  } catch (err) {
    console.error('Error joining team:', err);
    next(err);
  }
});

// POST /teams/:teamId/regenerate-code: 팀 초대 코드 재발급 (LEADER 전용)
app.post('/teams/:teamId/regenerate-code', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    if (!mem || mem.role !== 'LEADER') {
      req.session.errorMsg = '초대 코드 재발급 권한이 없습니다. (팀장 전용)';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    let inviteCode = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      inviteCode = generateInviteCode();
      const [existing] = await pool.query(`SELECT id FROM teams WHERE invite_code = ?`, [inviteCode]);
      if (existing.length === 0) isUnique = true;
      attempts++;
    }

    await pool.query(`UPDATE teams SET invite_code = ? WHERE id = ?`, [inviteCode, teamId]);
    req.session.successMsg = `팀 초대 코드가 성공적으로 갱신되었습니다: ${inviteCode}`;
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error regenerating code:', err);
    next(err);
  }
});

// POST /teams/:teamId/update: 팀명 및 소개 수정 (LEADER 전용)
app.post('/teams/:teamId/update', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const { name, description } = req.body;

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    if (!mem || mem.role !== 'LEADER') {
      req.session.errorMsg = '팀 정보 수정 권한이 없습니다. (팀장 전용)';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (!name || !name.trim()) {
      req.session.errorMsg = '팀명을 입력해 주세요.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    await pool.query(`UPDATE teams SET name = ?, description = ? WHERE id = ?`, [name.trim(), description ? description.trim() : '', teamId]);
    req.session.successMsg = '팀 정보가 수정되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error updating team:', err);
    next(err);
  }
});

// POST /teams/:teamId/delete: 팀 영구 삭제 (LEADER 전용)
app.post('/teams/:teamId/delete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    if (!mem || mem.role !== 'LEADER') {
      req.session.errorMsg = '팀 삭제 권한이 없습니다. (팀장 전용)';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM team_schedule_logs WHERE team_id = ?`, [teamId]);
      await conn.query(`DELETE FROM team_notes WHERE team_id = ?`, [teamId]);
      await conn.query(`DELETE FROM team_schedules WHERE team_id = ?`, [teamId]);
      await conn.query(`DELETE FROM team_members WHERE team_id = ?`, [teamId]);
      await conn.query(`DELETE FROM teams WHERE id = ?`, [teamId]);
      await conn.commit();
      req.session.successMsg = '팀이 성공적으로 삭제되었습니다.';
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    res.redirect('/teams');
  } catch (err) {
    console.error('Failed to delete team:', err);
    req.session.errorMsg = '팀 삭제 중 오류가 발생했습니다.';
    res.redirect('/teams');
  }
});

// POST /teams/:teamId/members/:memberId/update: 팀원 직책 및 권한 수정 (LEADER 전용, 팀장 자가강등 및 LEADER 임명 차단)
app.post('/teams/:teamId/members/:memberId/update', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const memberId = parseInt(req.params.memberId, 10);
    const { position, role } = req.body;

    const [myMems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const myMem = myMems[0];
    if (!myMem || myMem.role !== 'LEADER') {
      req.session.errorMsg = '팀원 정보 수정 권한이 없습니다. (팀장 전용)';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const [targetMems] = await pool.query(`SELECT * FROM team_members WHERE id = ? AND team_id = ?`, [memberId, teamId]);
    const targetMem = targetMems[0];
    if (!targetMem) {
      req.session.errorMsg = '해당 팀원을 찾을 수 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (targetMem.role === 'LEADER' || role === 'LEADER') {
      req.session.errorMsg = '팀장 권한은 일반 권한 변경으로 수정할 수 없습니다. [팀장 위임] 기능을 이용해 주세요.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const validRole = ['MANAGER', 'MEMBER'].includes(role) ? role : 'MEMBER';
    const posText = (position && position.trim()) ? position.trim() : '팀원';

    await pool.query(`
      UPDATE team_members SET position = ?, role = ? 
      WHERE id = ? AND team_id = ?
    `, [posText, validRole, memberId, teamId]);

    req.session.successMsg = '팀원 직책 및 권한이 성공적으로 수정되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error updating team member:', err);
    next(err);
  }
});

// POST /teams/:teamId/transfer-leader: 팀장 권한 위임 (LEADER 전용, 트랜잭션 무결성 보장)
app.post('/teams/:teamId/transfer-leader', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const targetMemberId = parseInt(req.body.target_member_id, 10);

    const [myMems] = await pool.query(`SELECT * FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const myMem = myMems[0];
    if (!myMem || myMem.role !== 'LEADER') {
      req.session.errorMsg = '팀장 권한 위임은 현재 팀장(LEADER)만 수행할 수 있습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const [targetMems] = await pool.query(`SELECT * FROM team_members WHERE id = ? AND team_id = ?`, [targetMemberId, teamId]);
    const targetMem = targetMems[0];
    if (!targetMem || targetMem.user_id === userId) {
      req.session.errorMsg = '위임 대상 팀원이 올바르지 않습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const [targetUsers] = await pool.query(`SELECT name FROM users WHERE id = ?`, [targetMem.user_id]);
    const targetUser = targetUsers[0];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const newPos = (targetMem.position === '팀원' || !targetMem.position) ? '팀장' : targetMem.position;
      await conn.query(`UPDATE team_members SET role = 'LEADER', position = ? WHERE id = ?`, [newPos, targetMemberId]);

      const myNewPos = myMem.position === '팀장' ? '팀원' : myMem.position;
      await conn.query(`UPDATE team_members SET role = 'MEMBER', position = ? WHERE id = ?`, [myNewPos, myMem.id]);

      await conn.query(`UPDATE teams SET owner_id = ? WHERE id = ?`, [targetMem.user_id, teamId]);
      await conn.commit();
      req.session.successMsg = `${targetUser ? targetUser.name : '팀원'}님에게 팀장 권한이 성공적으로 위임되었습니다.`;
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Failed to transfer leadership:', err);
    req.session.errorMsg = '팀장 권한 위임 처리 중 오류가 발생했습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  }
});

// POST /api/teams/move: 화살표 버튼 기반 인접한 두 팀의 sort_order 맞바꾸기
app.post('/api/teams/move', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { teamId, direction, targetTeamId } = req.body;
    const tid = parseInt(teamId, 10);

    if (!tid || isNaN(tid)) {
      return res.status(400).json({ success: false, error: '유효한 팀 ID가 필요합니다.' });
    }

    const [userTeams] = await pool.query(`
      SELECT tm.id as member_id, tm.team_id, tm.sort_order, tm.joined_at
      FROM team_members tm
      WHERE tm.user_id = ?
      ORDER BY tm.sort_order ASC, tm.joined_at ASC, tm.id ASC
    `, [userId]);

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

    const temp = userTeams[currentIndex];
    userTeams[currentIndex] = userTeams[targetIndex];
    userTeams[targetIndex] = temp;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let idx = 0; idx < userTeams.length; idx++) {
        await conn.query(`UPDATE team_members SET sort_order = ? WHERE user_id = ? AND team_id = ?`,
          [idx, userId, userTeams[idx].team_id]);
      }
      await conn.commit();
      return res.json({ success: true, message: '팀 순서가 성공적으로 변경되었습니다.' });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Failed to move team order:', err);
    return res.status(500).json({ success: false, error: '팀 순서 변경 중 오류가 발생했습니다.' });
  }
});

// POST /api/teams/reorder: 팀 목록 사용자별 드래그 앤 드롭 순서 저장
app.post('/api/teams/reorder', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { order, teamIds } = req.body;
    const list = order || teamIds;

    if (!Array.isArray(list)) {
      return res.status(400).json({ error: '유효한 팀 순서 배열이 필요합니다.' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let idx = 0; idx < list.length; idx++) {
        await conn.query(`UPDATE team_members SET sort_order = ? WHERE user_id = ? AND team_id = ?`,
          [idx, userId, parseInt(list[idx], 10)]);
      }
      await conn.commit();
      return res.json({ success: true, message: '팀 정렬 순서가 저장되었습니다.' });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Failed to save team sort order:', err);
    return res.status(500).json({ error: '순서 저장 중 오류가 발생했습니다.' });
  }
});

// POST /teams/:teamId/members/:memberId/remove: 팀원 추방 (LEADER 전용, 본인 추방 방지)
app.post('/teams/:teamId/members/:memberId/remove', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const memberId = parseInt(req.params.memberId, 10);

    const [myMems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const myMem = myMems[0];
    if (!myMem || myMem.role !== 'LEADER') {
      req.session.errorMsg = '팀원 내보내기 권한이 없습니다. (팀장 전용)';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const [targetMems] = await pool.query(`SELECT user_id, position FROM team_members WHERE id = ? AND team_id = ?`, [memberId, teamId]);
    const targetMem = targetMems[0];
    if (!targetMem) {
      req.session.errorMsg = '해당 팀원을 찾을 수 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (targetMem.user_id === userId) {
      req.session.errorMsg = '팀장 본인은 팀에서 추방할 수 없습니다. 필요 시 [팀 삭제] 또는 [팀장 위임]을 이용해 주세요.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    await pool.query(`DELETE FROM team_members WHERE id = ? AND team_id = ?`, [memberId, teamId]);
    req.session.successMsg = '해당 팀원을 팀에서 성공적으로 내보냈습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error removing team member:', err);
    next(err);
  }
});

// POST /teams/:teamId/leave: 팀 탈퇴 (팀장 탈퇴 시 최초 가입자에게 LEADER 자동 위임)
app.post('/teams/:teamId/leave', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);

    const [teams] = await pool.query(`SELECT * FROM teams WHERE id = ?`, [teamId]);
    const team = teams[0];
    const [myMems] = await pool.query(`SELECT * FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const myMem = myMems[0];

    if (!team || !myMem) {
      req.session.errorMsg = '소속된 팀을 찾을 수 없거나 이미 탈퇴한 팀입니다.';
      return res.redirect('/teams');
    }

    const [otherMembers] = await pool.query(`
      SELECT * FROM team_members 
      WHERE team_id = ? AND user_id != ? 
      ORDER BY joined_at ASC, id ASC
    `, [teamId, userId]);

    if (otherMembers.length === 0) {
      await pool.query(`DELETE FROM teams WHERE id = ?`, [teamId]);
      req.session.successMsg = `"${team.name}" 팀의 마지막 인원으로서 팀 및 관련 데이터가 모두 정리되었습니다.`;
      return res.redirect('/teams');
    }

    if (myMem.role === 'LEADER' || team.owner_id === userId) {
      const successor = otherMembers[0];
      await pool.query(`
        UPDATE team_members 
        SET role = 'LEADER', position = CASE WHEN position = '팀원' THEN '팀장' ELSE position END 
        WHERE id = ?
      `, [successor.id]);

      await pool.query(`UPDATE teams SET owner_id = ? WHERE id = ?`, [successor.user_id, teamId]);

      const [myUsers] = await pool.query(`SELECT name FROM users WHERE id = ?`, [userId]);
      const myUser = myUsers[0];
      const leaveMsg = `[${team.name}] 기존 팀장(${myUser ? myUser.name : '팀장'})님이 탈퇴하여 팀장 권한을 자동 위임받았습니다.`;
      await pool.query(`
        INSERT INTO notifications (user_id, type, message, link_url)
        VALUES (?, 'TEAM_SCHEDULE', ?, ?)
      `, [successor.user_id, leaveMsg, `/teams?teamId=${teamId}`]);
    }

    await pool.query(`DELETE FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    await pool.query(`DELETE FROM user_top3_team_schedules WHERE user_id = ? AND team_schedule_id IN (SELECT id FROM team_schedules WHERE team_id = ?)`, [userId, teamId]);

    req.session.successMsg = `"${team.name}" 팀에서 성공적으로 탈퇴했습니다.`;
    res.redirect('/teams');
  } catch (err) {
    console.error('Error leaving team:', err);
    next(err);
  }
});

// POST /teams/:teamId/invite: @아이디 기반 팀 초대 발송 (second.md 3번)
app.post('/teams/:teamId/invite', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    let { username } = req.body;

    if (!username) {
      req.session.errorMsg = '초대할 사용자의 아이디를 입력해 주세요.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    username = username.trim();
    if (username.startsWith('@')) {
      username = username.slice(1).trim();
    }

    // 1. Verify team membership
    const [myMems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const myMem = myMems[0];
    const [teams] = await pool.query(`SELECT name FROM teams WHERE id = ?`, [teamId]);
    const team = teams[0];
    if (!myMem || !team) {
      req.session.errorMsg = '팀 정보를 찾을 수 없거나 팀원이 아닙니다.';
      return res.redirect('/teams');
    }

    // 2. Find invitee user
    const [invitees] = await pool.query(`SELECT id, username, name FROM users WHERE username = ?`, [username]);
    const invitee = invitees[0];
    if (!invitee) {
      req.session.errorMsg = `존재하지 않는 사용자 아이디입니다 (@${username}).`;
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (invitee.id === userId) {
      req.session.errorMsg = '본인 계정은 초대할 수 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    // 3. Check if already a member
    const [existingMems] = await pool.query(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, invitee.id]);
    if (existingMems.length > 0) {
      req.session.errorMsg = `@${username} (${invitee.name})님은 이미 본 팀의 멤버입니다.`;
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    // 4. Check if already has a pending invitation
    const [pendingRows] = await pool.query(`SELECT id FROM team_invitations WHERE team_id = ? AND invitee_id = ? AND status = 'PENDING'`, [teamId, invitee.id]);
    if (pendingRows.length > 0) {
      req.session.errorMsg = `@${username}님에게 이미 대기 중인 초대장이 발송되어 있습니다.`;
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    // 5. Create team_invitations record
    await pool.query(`
      INSERT INTO team_invitations (team_id, inviter_id, invitee_id, status)
      VALUES (?, ?, ?, 'PENDING')
    `, [teamId, userId, invitee.id]);

    // 6. Create notification for invitee
    const [inviterUsers] = await pool.query(`SELECT name FROM users WHERE id = ?`, [userId]);
    const inviterUser = inviterUsers[0];
    const notifMsg = `"${team.name}" 팀에서 ${inviterUser ? inviterUser.name : '팀원'}님이 팀으로 초대했습니다.`;
    await pool.query(`
      INSERT INTO notifications (user_id, type, message, link_url)
      VALUES (?, 'TEAM_INVITE', ?, ?)
    `, [invitee.id, notifMsg, `/teams?teamId=${teamId}`]);

    req.session.successMsg = `@${username} (${invitee.name})님에게 팀 초대장을 발송했습니다!`;
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error inviting member:', err);
    next(err);
  }
});

// POST /teams/:teamId/schedules: 팀 공유 일정 등록 (LEADER / MANAGER)
app.post('/teams/:teamId/schedules', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const { title, description, due_datetime, no_deadline } = req.body;

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
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

    const [insertResult] = await pool.query(`
      INSERT INTO team_schedules (team_id, author_id, title, description, due_datetime, status)
      VALUES (?, ?, ?, ?, ?, 'TODO')
    `, [teamId, userId, title.trim(), description ? description.trim() : '', formattedDue]);

    // Audit Log
    await logTeamScheduleAction(teamId, insertResult.insertId, title.trim(), userId, 'CREATED', '팀 일정 등록');

    req.session.successMsg = '새 팀 공유 일정이 등록되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error creating team schedule:', err);
    next(err);
  }
});

// POST /teams/:teamId/schedules/:id/update: 팀 일정 내용 수정 (작성자 본인 또는 LEADER / MANAGER)
app.post('/teams/:teamId/schedules/:id/update', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const id = parseInt(req.params.id, 10);
    const { title, description, due_datetime, status, no_deadline } = req.body;

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    const [scheds] = await pool.query(`SELECT * FROM team_schedules WHERE id = ? AND team_id = ?`, [id, teamId]);
    const sched = scheds[0];

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json');

    if (!mem || !sched) {
      if (isAsync) return res.status(403).json({ success: false, error: '수정할 일정이 없거나 권한이 없습니다.' });
      req.session.errorMsg = '수정할 일정이 없거나 권한이 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (mem.role !== 'LEADER' && mem.role !== 'MANAGER' && sched.author_id !== userId) {
      if (isAsync) return res.status(403).json({ success: false, error: '해당 팀 일정을 수정할 권한이 없습니다.' });
      req.session.errorMsg = '해당 팀 일정을 수정할 권한이 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const finalTitle = (title !== undefined && title !== null) ? title.trim() : sched.title;
    if (!finalTitle) {
      if (isAsync) return res.status(400).json({ success: false, error: '일정 제목을 입력해 주세요.' });
      req.session.errorMsg = '일정 제목을 입력해 주세요.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const validStatus = ['TODO', 'IN_PROGRESS', 'DONE'].includes(status) ? status : sched.status;
    const isNoDeadline = (no_deadline === 'on' || no_deadline === 'true' || no_deadline === true || (!due_datetime && due_datetime !== undefined));
    let formattedDue = sched.due_datetime;
    if (isNoDeadline) {
      formattedDue = null;
    } else if (due_datetime) {
      formattedDue = due_datetime.replace('T', ' ').slice(0, 16);
    }

    const finalDesc = (description !== undefined && description !== null) ? description.trim() : (sched.description || '');

    await pool.query(`
      UPDATE team_schedules 
      SET title = ?, description = ?, due_datetime = ?, status = ?
      WHERE id = ? AND team_id = ?
    `, [finalTitle, finalDesc, formattedDue, validStatus, id, teamId]);

    // Audit Log
    const changeDetail = `제목: "${sched.title}" -> "${finalTitle}", 마감: ${sched.due_datetime || '상시'} -> ${formattedDue || '상시'}, 상태: ${sched.status} -> ${validStatus}`;
    await logTeamScheduleAction(teamId, id, finalTitle, userId, 'UPDATED', changeDetail);

    if (isAsync) {
      return res.json({ success: true, message: '팀 일정이 수정되었습니다.', due_datetime: formattedDue, status: validStatus });
    }

    req.session.successMsg = '팀 일정이 수정되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error updating team schedule:', err);
    next(err);
  }
});

// POST /teams/:teamId/schedules/:id/status: 팀 일정 상태 변경 (팀원 누구나)
app.post('/teams/:teamId/schedules/:id/status', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    const isAsync = req.xhr || req.headers.accept?.includes('application/json') || req.is('json');

    const [mems] = await pool.query(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    const [scheds] = await pool.query(`SELECT * FROM team_schedules WHERE id = ? AND team_id = ?`, [id, teamId]);
    const sched = scheds[0];
    if (!mem || !sched) {
      if (isAsync) {
        return res.status(403).json({ success: false, error: '해당 팀의 팀원이 아니거나 일정을 찾을 수 없습니다.' });
      }
      req.session.errorMsg = '해당 팀의 팀원이 아니거나 일정을 찾을 수 없습니다.';
      return res.redirect('/teams');
    }

    const validStatus = ['TODO', 'IN_PROGRESS', 'DONE'].includes(status) ? status : 'TODO';

    await pool.query(`
      UPDATE team_schedules SET status = ? 
      WHERE id = ? AND team_id = ?
    `, [validStatus, id, teamId]);

    // Audit Log
    await logTeamScheduleAction(teamId, id, sched.title, userId, 'STATUS_CHANGED', `상태 변경: ${sched.status} -> ${validStatus}`);

    if (isAsync) {
      return res.json({ success: true, status: validStatus });
    }

    req.session.successMsg = '팀 일정 상태가 변경되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error updating team schedule status:', err);
    next(err);
  }
});

// POST /teams/:teamId/schedules/:id/delete: 팀 일정 삭제 (LEADER / MANAGER 또는 본인)
app.post('/teams/:teamId/schedules/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const id = parseInt(req.params.id, 10);

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    const [scheds] = await pool.query(`SELECT * FROM team_schedules WHERE id = ? AND team_id = ?`, [id, teamId]);
    const sched = scheds[0];

    if (!mem || !sched) {
      req.session.errorMsg = '삭제할 일정이 없거나 권한이 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (mem.role !== 'LEADER' && mem.role !== 'MANAGER' && sched.author_id !== userId) {
      req.session.errorMsg = '해당 팀 일정을 삭제할 권한이 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    await pool.query(`DELETE FROM team_schedules WHERE id = ? AND team_id = ?`, [id, teamId]);

    // Audit Log
    await logTeamScheduleAction(teamId, id, sched.title, userId, 'DELETED', `팀 일정 "${sched.title}" 삭제됨`);

    req.session.successMsg = '팀 일정이 삭제되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error deleting team schedule:', err);
    next(err);
  }
});

// POST /teams/:teamId/notes: 팀 특이사항/공지 등록 (팀원 누구나)
app.post('/teams/:teamId/notes', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const { category, title, content } = req.body;

    const [mems] = await pool.query(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    if (!mem) {
      req.session.errorMsg = '해당 팀의 팀원이 아닙니다.';
      return res.redirect('/teams');
    }

    if (!title || !title.trim() || !content || !content.trim()) {
      req.session.errorMsg = '특이사항 제목과 내용을 모두 입력해 주세요.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    const validCategory = ['공지', '특이사항', '회의록', '이슈'].includes(category) ? category : '특이사항';

    await pool.query(`
      INSERT INTO team_notes (team_id, author_id, category, title, content, is_pinned)
      VALUES (?, ?, ?, ?, ?, 0)
    `, [teamId, userId, validCategory, title.trim(), content.trim()]);

    req.session.successMsg = '특이사항 / 메모가 등록되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error creating team note:', err);
    next(err);
  }
});

// POST /teams/:teamId/notes/:id/pin: 특이사항 상단 고정 토글 (LEADER / MANAGER)
app.post('/teams/:teamId/notes/:id/pin', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const id = parseInt(req.params.id, 10);

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    if (!mem || (mem.role !== 'LEADER' && mem.role !== 'MANAGER')) {
      req.session.errorMsg = '특이사항 상단 고정 권한이 없습니다. (팀장/운영진 전용)';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    await pool.query(`
      UPDATE team_notes 
      SET is_pinned = (CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END) 
      WHERE id = ? AND team_id = ?
    `, [id, teamId]);

    req.session.successMsg = '특이사항 고정 상태가 변경되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error toggling team note pin:', err);
    next(err);
  }
});

// POST /teams/:teamId/notes/:id/delete: 특이사항 삭제 (LEADER/MANAGER는 전체, MEMBER는 본인 글만)
app.post('/teams/:teamId/notes/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const teamId = parseInt(req.params.teamId, 10);
    const id = parseInt(req.params.id, 10);

    const [mems] = await pool.query(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`, [teamId, userId]);
    const mem = mems[0];
    const [notes] = await pool.query(`SELECT * FROM team_notes WHERE id = ? AND team_id = ?`, [id, teamId]);
    const note = notes[0];

    if (!mem || !note) {
      req.session.errorMsg = '삭제할 특이사항이 없거나 권한이 없습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    if (mem.role !== 'LEADER' && mem.role !== 'MANAGER' && note.author_id !== userId) {
      req.session.errorMsg = '본인이 작성한 특이사항만 삭제할 수 있습니다.';
      return res.redirect(`/teams?teamId=${teamId}`);
    }

    await pool.query(`DELETE FROM team_notes WHERE id = ? AND team_id = ?`, [id, teamId]);
    req.session.successMsg = '특이사항이 삭제되었습니다.';
    res.redirect(`/teams?teamId=${teamId}`);
  } catch (err) {
    console.error('Error deleting team note:', err);
    next(err);
  }
});

// ==========================================
// 10. My Page Routes
// ==========================================

app.get('/mypage', isAuthenticated, requireMemberAccount, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];

    const [statsRows] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as done,
        SUM(focus_minutes) as focus_total
      FROM schedules WHERE user_id = ?
    `, [userId]);
    const scheduleStats = statsRows[0];

    const [customWidgets] = await pool.query(`SELECT * FROM user_custom_widgets WHERE user_id = ? ORDER BY id ASC`, [userId]);

    res.render('mypage', {
      user,
      stats: scheduleStats,
      activeMenu: 'mypage',
      customWidgets,
      dashboardLayout: getEffectiveDashboardLayout(user ? user.dashboard_layout : null, customWidgets),
      widgetSpecs: WIDGET_SPECS,
      buildCustomWidgetSrcdoc,
      isGuest: false
    });
  } catch (err) {
    console.error('Error in GET /mypage:', err);
    next(err);
  }
});

app.post('/mypage/profile', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      req.session.errorMsg = '이름을 입력해 주세요.';
      return res.redirect('/mypage');
    }

    await pool.query(`UPDATE users SET name = ? WHERE id = ?`, [name.trim(), userId]);
    req.session.name = name.trim();
    req.session.successMsg = '프로필 이름이 성공적으로 변경되었습니다.';
    res.redirect('/mypage');
  } catch (err) {
    console.error('Error updating profile:', err);
    next(err);
  }
});

app.post('/mypage/password', isAuthenticated, async (req, res, next) => {
  try {
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

    const [users] = await pool.query(`SELECT password FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    if (!bcrypt.compareSync(current_password, user.password)) {
      req.session.errorMsg = '현재 비밀번호가 올바르지 않습니다.';
      return res.redirect('/mypage');
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    await pool.query(`UPDATE users SET password = ? WHERE id = ?`, [newHash, userId]);

    req.session.successMsg = '비밀번호가 성공적으로 변경되었습니다.';
    res.redirect('/mypage');
  } catch (err) {
    console.error('Error updating password:', err);
    next(err);
  }
});

app.post('/mypage/telegram-unlink', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    await pool.query(`UPDATE users SET telegram_chat_id = NULL WHERE id = ?`, [userId]);
    req.session.successMsg = '텔레그램 연동이 해제되었습니다.';
    res.redirect('/mypage');
  } catch (err) {
    console.error('Error unlinking telegram:', err);
    next(err);
  }
});

app.post('/mypage/delete-account', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    await pool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    req.session.destroy(() => {
      res.redirect('/login');
    });
  } catch (err) {
    console.error('Error deleting account:', err);
    next(err);
  }
});

// ==========================================
// 11. Admin Control Panel Routes
// ==========================================

function maskSecret(val) {
  if (!val || val.length === 0) return '';
  if (val.length <= 6) return '******';
  return val.substring(0, 6) + '********';
}

app.get('/admin', isAdmin, async (req, res, next) => {
  try {
    // 1. KPI Counts
    const [uRows] = await pool.query(`SELECT COUNT(*) as c FROM users`);
    const totalUsers = uRows[0].c;
    const [sRows] = await pool.query(`SELECT COUNT(*) as c FROM schedules`);
    const totalSchedules = sRows[0].c;
    const todayStr = getKoreanDateString(0);
    const [aRows] = await pool.query(`
      SELECT COUNT(*) as c FROM notification_logs WHERE created_at LIKE ?
    `, [`${todayStr}%`]);
    const todayAlerts = aRows[0].c;
    const [tRows] = await pool.query(`
      SELECT COUNT(*) as c FROM users WHERE telegram_chat_id IS NOT NULL
    `);
    const connectedTelegramUsers = tRows[0].c;

    // 2. Settings (masked)
    const rawBotToken = await getSetting('telegram_bot_token');
    const rawGeminiKey = await getSetting('gemini_api_key');
    const botEnabled = (await getSetting('bot_enabled')) === 'true';

    const settings = {
      telegram_bot_token: maskSecret(rawBotToken),
      gemini_api_key: maskSecret(rawGeminiKey),
      bot_enabled: botEnabled
    };

    // 3. User list with schedule counts
    const [users] = await pool.query(`
      SELECT u.*, COUNT(s.id) as schedule_count
      FROM users u
      LEFT JOIN schedules s ON s.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    // 4. Recent Notification Logs
    const [logs] = await pool.query(`
      SELECT nl.*, u.name as user_name, u.username
      FROM notification_logs nl
      LEFT JOIN users u ON u.id = nl.user_id
      ORDER BY nl.created_at DESC
      LIMIT 25
    `);

    const [currUsers] = await pool.query(`SELECT * FROM users WHERE id = ?`, [req.session.userId]);
    const currentUserData = currUsers[0];

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
  } catch (err) {
    console.error('Error in GET /admin:', err);
    next(err);
  }
});

// Admin Settings Update
app.post('/admin/settings', isAdmin, async (req, res, next) => {
  try {
    const { telegram_bot_token, bot_enabled, gemini_api_key } = req.body;

    if (telegram_bot_token && !telegram_bot_token.includes('****')) {
      await setSetting('telegram_bot_token', telegram_bot_token.trim());
    }
    await setSetting('bot_enabled', bot_enabled === 'true' ? 'true' : 'false');

    if (gemini_api_key && !gemini_api_key.includes('****')) {
      await setSetting('gemini_api_key', gemini_api_key.trim());
    }

    req.session.successMsg = '시스템 환경설정이 성공적으로 저장되었습니다.';
    res.redirect('/admin');
  } catch (err) {
    console.error('Error saving admin settings:', err);
    next(err);
  }
});

// Admin Broadcast to All Linked Users
app.post('/admin/broadcast', isAdmin, async (req, res, next) => {
  try {
    const { broadcast_message } = req.body;
    if (!broadcast_message || broadcast_message.trim() === '') {
      req.session.errorMsg = '공지 메시지 내용을 입력해 주세요.';
      return res.redirect('/admin');
    }

    const [linkedUsers] = await pool.query(`SELECT * FROM users WHERE telegram_chat_id IS NOT NULL`);
    let successCount = 0;

    for (const user of linkedUsers) {
      const formatted = `📢 [WorkSmarter 시스템 전체 공지]\n\n${broadcast_message.trim()}\n\n- 관리자 드림 -`;
      const ok = await sendTelegramMessage(user.telegram_chat_id, formatted, user.id, 'ADMIN_BROADCAST');
      if (ok) successCount++;
    }

    req.session.successMsg = `총 ${linkedUsers.length}명 중 ${successCount}명에게 전체 공지를 성공적으로 발송했습니다.`;
    res.redirect('/admin');
  } catch (err) {
    console.error('Error in admin broadcast:', err);
    next(err);
  }
});

// Reset Telegram for a specific user
app.post('/admin/users/:id/reset-telegram', isAdmin, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    await pool.query(`UPDATE users SET telegram_chat_id = NULL, telegram_link_code = NULL WHERE id = ?`, [targetId]);
    req.session.successMsg = `해당 회원의 텔레그램 연동이 초기화되었습니다.`;
    res.redirect('/admin');
  } catch (err) {
    console.error('Error resetting telegram:', err);
    next(err);
  }
});

// Delete user by admin
app.post('/admin/users/:id/delete', isAdmin, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    if (parseInt(targetId, 10) === req.session.userId) {
      req.session.errorMsg = '현재 로그인 중인 본인 관리자 계정은 삭제할 수 없습니다.';
      return res.redirect('/admin');
    }

    await pool.query(`DELETE FROM users WHERE id = ?`, [targetId]);
    req.session.successMsg = `회원(ID: ${targetId})이 영구 삭제되었습니다.`;
    res.redirect('/admin');
  } catch (err) {
    console.error('Error deleting user:', err);
    next(err);
  }
});

// ==========================================
// 8. Notes & Documentation Workspace Routes (newdawn.md)
// ==========================================

// GET /notes: Main Notes & Documentation Workspace
app.get('/notes', isAuthenticated, requireMemberAccount, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const [users] = await pool.query(`SELECT * FROM users WHERE id = ?`, [userId]);
    const user = users[0];

    // 1. Fetch user's notes
    const [rawNotes] = await pool.query(`
      SELECT * FROM user_notes 
      WHERE user_id = ? 
      ORDER BY updated_at DESC
    `, [userId]);

    // 2. Fetch personal schedules for dropdown linking
    const [personalSchedules] = await pool.query(`
      SELECT id, title, category, due_datetime 
      FROM schedules 
      WHERE user_id = ? 
      ORDER BY due_datetime IS NULL ASC, due_datetime ASC
    `, [userId]);

    // 3. Fetch team schedules for dropdown linking
    const [teamSchedules] = await pool.query(`
      SELECT ts.id, ts.title, ts.due_datetime, ts.team_id, t.name as team_name
      FROM team_schedules ts
      JOIN teams t ON t.id = ts.team_id
      WHERE ts.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
      ORDER BY ts.due_datetime IS NULL ASC, ts.due_datetime ASC
    `, [userId]);

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
        const ps = personalSchedules.find(s => s.id === note.linked_schedule_id);
        linkedTitle = ps ? ps.title : null;
      } else if (note.linked_type === 'TEAM' && note.linked_schedule_id) {
        const ts = teamSchedules.find(s => s.id === note.linked_schedule_id);
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
  } catch (err) {
    console.error('Error in GET /notes:', err);
    next(err);
  }
});

// POST /api/notes: Create new Note
app.post('/api/notes', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const title = (req.body.title || '새 문서').trim();
    const content = (req.body.content || '').trim();
    const linked_type = ['PERSONAL', 'TEAM'].includes(req.body.linked_type) ? req.body.linked_type : 'NONE';
    const linked_schedule_id = req.body.linked_schedule_id ? parseInt(req.body.linked_schedule_id, 10) : null;

    const [result] = await pool.query(`
      INSERT INTO user_notes (user_id, title, content, linked_type, linked_schedule_id, links_json, attachments_json)
      VALUES (?, ?, ?, ?, ?, '[]', '[]')
    `, [userId, title, content, linked_type, linked_schedule_id]);

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [result.insertId, userId]);
    const note = noteRows[0];
    
    if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
      return res.json({ success: true, note });
    }
    res.redirect(`/notes?noteId=${result.insertId}`);
  } catch (err) {
    console.error('Error creating note:', err);
    next(err);
  }
});

// GET /api/notes/:id: Fetch specific note
app.get('/api/notes/:id', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
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
  } catch (err) {
    console.error('Error fetching note:', err);
    res.status(500).json({ success: false, error: '문서 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/notes/:id/autosave: Debounced Autosave (1000ms delay from client)
app.post('/api/notes/:id/autosave', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    const { title, content, linked_type, linked_schedule_id, links_json } = req.body;

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
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

    await pool.query(`
      UPDATE user_notes 
      SET title = ?, content = ?, linked_type = ?, linked_schedule_id = ?, links_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `, [safeTitle, safeContent, validLinkedType, validLinkedId, updatedLinksJson, noteId, userId]);

    const [updatedNoteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const updatedNote = updatedNoteRows[0];
    res.json({ success: true, note: updatedNote, updated_at: updatedNote.updated_at });
  } catch (err) {
    console.error('Error autosaving note:', err);
    res.status(500).json({ success: false, error: '문서 자동 저장 중 오류가 발생했습니다.' });
  }
});

// POST /api/notes/:id/delete: Delete note
app.post('/api/notes/:id/delete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
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

    await pool.query(`DELETE FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);

    if (req.xhr || req.headers.accept?.includes('application/json') || req.is('json')) {
      return res.json({ success: true });
    }
    req.session.successMsg = '문서가 삭제되었습니다.';
    res.redirect('/notes');
  } catch (err) {
    console.error('Error deleting note:', err);
    next(err);
  }
});

// POST /api/notes/:id/links: Update links
app.post('/api/notes/:id/links', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    const { links } = req.body;

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
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
    await pool.query(`
      UPDATE user_notes 
      SET links_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `, [safeLinksJson, noteId, userId]);

    res.json({ success: true, links: linksArray });
  } catch (err) {
    console.error('Error updating links:', err);
    res.status(500).json({ success: false, error: '링크 업데이트 중 오류가 발생했습니다.' });
  }
});

// POST /api/notes/:id/upload: Multer file upload (Max 5MB, whitelisted exts)
app.post('/api/notes/:id/upload', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);

    // Check ownership first
    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
    if (!note) {
      return res.status(404).json({ success: false, error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' });
    }

    uploadNoteAttachment.single('file')(req, res, async function (err) {
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

      try {
        await pool.query(`
          UPDATE user_notes 
          SET attachments_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?
        `, [JSON.stringify(attachments), noteId, userId]);

        res.json({
          success: true,
          attachment: newAttachment,
          attachments
        });
      } catch (dbErr) {
        console.error('Error saving attachment metadata:', dbErr);
        res.status(500).json({ success: false, error: '첨부파일 정보 저장에 실패했습니다.' });
      }
    });
  } catch (err) {
    console.error('Error in upload route:', err);
    next(err);
  }
});

// GET /api/notes/:id/download/:storedName: Download attached file
app.get('/api/notes/:id/download/:storedName', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    const storedName = path.basename(req.params.storedName);

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
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
  } catch (err) {
    console.error('Error downloading attachment:', err);
    next(err);
  }
});

// POST /api/notes/:id/attachments/delete: Delete attachment
app.post('/api/notes/:id/attachments/delete', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const noteId = parseInt(req.params.id, 10);
    const { storedName } = req.body;

    if (!storedName) {
      return res.status(400).json({ success: false, error: '삭제할 파일명이 지정되지 않았습니다.' });
    }

    const safeStoredName = path.basename(storedName);

    const [noteRows] = await pool.query(`SELECT * FROM user_notes WHERE id = ? AND user_id = ?`, [noteId, userId]);
    const note = noteRows[0];
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

    await pool.query(`
      UPDATE user_notes 
      SET attachments_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `, [JSON.stringify(attachments), noteId, userId]);

    res.json({ success: true, attachments });
  } catch (err) {
    console.error('Error deleting attachment:', err);
    res.status(500).json({ success: false, error: '첨부파일 삭제 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// 12. Server Startup
// ==========================================
if (require.main === module) {
  initDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(` WorkSmarter 스마트 일정 및 워크스페이스 관리 서버 시작됨`);
      console.log(` 포트: http://localhost:${PORT}`);
      console.log(` 현재 한국 시간(KST): ${getKoreanTimeString(0)}`);
      console.log(`=======================================================`);
    });
  }).catch(err => {
    console.error('데이터베이스 초기화 실패:', err);
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(` WorkSmarter 서버 시작 (DB 초기화 실패 상태)`);
      console.log(` 포트: http://localhost:${PORT}`);
      console.log(`=======================================================`);
    });
  });
}

module.exports = app;
