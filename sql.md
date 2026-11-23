현재 `WorkSmarter` 프로젝트의 데이터베이스 엔진을 기존 동기식 SQLite(`better-sqlite3`)에서 비동기식 **MySQL(`mysql2/promise` 커넥션 풀 방식)**로 전면 마이그레이션하고, 최종 프로젝트 구조와 실제 DB 스키마를 반영하여 루트의 **`README.md`**까지 한 번에 완성해 주세요.

기존에 구현된 모든 기능(개인 대시보드 및 모듈형 GridStack 위젯, 플로팅 PIP 모드, 핵심 목표 Top 3, 칸반 보드, 월간 캘린더·만료 일정 자동 분류/복구·상시 일정 양방향 드래그·우클릭 상세보기 팝오버, 세부사항/문서함 및 일정 태그, 팀 워크스페이스·전용 캘린더·팀 나가기·`@아이디` 초대 및 실시간 알림함, 게스트 모드)과 보안 규칙(SQL 파라미터 바인딩 `?`, IDOR 소유권 방어, XSS 이스케이프)은 100% 동일하게 유지되어야 합니다.

---

## PART 1. SQLite → MySQL(`mysql2/promise`) 완전 전환 (`package.json`, `.env.example`, `app.js`)

### 1. 패키지 및 환경변수 구성
* `package.json`에서 `better-sqlite3`를 제거하고 **`mysql2`**와 **`dotenv`**를 사용하도록 설정하세요.
* `.env.example`(및 `.env`가 없다면 기본 템플릿)에 MySQL 접속 변수를 정의하세요:
  ```env
  PORT=3000
  SESSION_SECRET=worksmarter_secret_key
  DB_HOST=127.0.0.1
  DB_PORT=3306
  DB_USER=root
  DB_PASSWORD=your_password
  DB_NAME=worksmarter
MySQL 커넥션 풀 및 InnoDB 자동 스키마 생성 (app.js)
mysql2/promise의 mysql.createPool({ host, port, user, password, database, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' })를 구성하세요.

서버 시작 시 DB 연결 확인 후, 현재 프로젝트의 모든 테이블을 CREATE TABLE IF NOT EXISTS ... ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 문법으로 자동 초기화하세요.

SQLite → MySQL 문법 및 API 치환 규칙 (누락 없이 전수 적용):

INTEGER PRIMARY KEY AUTOINCREMENT → INT AUTO_INCREMENT PRIMARY KEY

SQLite 전용 시간/메타 함수(datetime('now'), sqlite_master, PRAGMA 등) → MySQL 표준(NOW(), INFORMATION_SCHEMA.COLUMNS 등)으로 교체

다건 조회: const [rows] = await pool.query(sql, params);

단건 조회: const [rows] = await pool.query(sql, params); const row = rows[0];

INSERT 후 생성된 PK 확인: const [result] = await pool.query(sql, params); const insertId = result.insertId; (lastInsertRowid 전부 제거)

UPDATE / DELETE 반영 건수 확인: result.affectedRows (changes 전부 제거)

트랜잭션(db.transaction): const conn = await pool.getConnection(); 후 await conn.beginTransaction(); ~ await conn.commit(); (try-catch-finally 블록으로 await conn.rollback(); 및 conn.release(); 철저히 보장)

3. 모든 Express 라우트 핸들러 async / await 전환
app.js 내의 모든 라우트 콜백을 async (req, res, next) => { try { ... } catch (err) { ... } } 형태로 전환하여 동기식 호출 잔재(Promise { <pending> } 반환 버그)가 단 한 곳도 남지 않도록 전수 점검하세요.

PART 2. README.md 최신화 (기술 스택 역할 명시 + Mermaid DB ERD 작성)
DB 마이그레이션 완료 후, 실제 app.js에 생성된 MySQL 테이블 구조와 전체 소스 코드를 기준으로 루트 경로의 README.md를 아래 목차대로 깔끔하게 작성해 주세요.

1. 프로젝트 소개 및 핵심 기능 요약
WorkSmarter 서비스 개요

개인 워크스페이스(모듈형 GridStack 대시보드, 플로팅 PIP 팝업, Top 3, 칸반, 캘린더, 만료/상시 일정 관리), 세부사항/문서함(노트, 일정 태그, 파일 첨부), 팀 협업 공간(전용 팀 캘린더, @아이디 초대, 실시간 알림함), 브라우저 캐시 기반 게스트 모드 정리

2. 핵심 기술 스택 및 아키텍처 역할 상세 설명 (Node.js · Express · EJS · MySQL)
각 기술이 프로젝트의 어디에 어떻게 적용되었는지 역할과 구현 포인트를 명확히 서술하세요:

Node.js (Backend Runtime): 비동기 이벤트 루프 기반 서버 구동, fs/path 모듈을 통한 업로드 파일 및 정적 자산 관리, dns/https 모듈을 활용한 외부 알림 API 비동기 통신 처리

Express (Web Framework): RESTful 라우팅 및 비동기 JSON API(/api/*) 설계, express-session 기반 사용자 인증 및 권한 검증 미들웨어(팀 멤버십·IDOR 방어), multer 기반 문서 파일 업로드 처리

EJS (View Template Engine): SSR(Server-Side Rendering) 기반 동적 화면 렌더링, 공통 레이아웃 모듈화(고정 사이드바, 상단 실시간 24시간 시계 및 알림함 헤더), <%= %> 자동 HTML 이스케이프 처리를 통한 XSS 방어

MySQL (mysql2/promise): InnoDB 스토리지 엔진 및 커넥션 풀(Connection Pool) 기반 관계형 데이터 모델링, 외래키(FOREIGN KEY ... ON DELETE CASCADE) 참조 무결성 및 트랜잭션 제어, Prepared Statement(? 바인딩)를 통한 SQL 인젝션 차단

3. 데이터베이스 ERD (Entity-Relationship Diagram)
app.js에 실제 정의된 모든 MySQL 테이블의 전체 컬럼명, 데이터 타입, PK / FK 제약조건, 테이블 간 기수성(||--o{ 등)을 GitHub에서 바로 렌더링되는 Mermaid erDiagram 코드 블록으로 정확하게 작성하세요.

다이어그램 하단에 핵심 테이블별 역할 및 관계 설명 표를 함께 수록하세요.

4. 디렉토리 구조 및 실행 가이드
현재 프로젝트 폴더 트리 구조

사전 요구사항(Node.js, MySQL), npm install, .env 설정, CREATE DATABASE worksmarter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;, node app.js 실행 순서 안내

(주의: AI 관련 홍보 문구나 기본 계정 아이디/비밀번호 정보는 절대 포함하지 마세요.)

수정 및 생성되는 모든 파일의 변경 사항을 누락 없이 반영해 주세요.
