현재 로컬 `WorkSmarter` 프로젝트(`app.js`, `views/index.ejs`, `views/mypage.ejs`, `public/style.css`)의 기존 기능(GridStack 모듈형 대시보드, PIP 모드, Top 3 드래그 앤 드롭, 칸반/캘린더/문서함, 보안 규칙)을 모두 유지하면서 **사용자가 직접 위젯을 제작하고 JSON 코드로 공유·설치할 수 있는 '커스텀 위젯 빌더 & 마켓' 기능**을 추가해 주세요.

특히 사용자가 만든 커스텀 위젯이 기존 기본 위젯들과 **시각적 일관성(노션 스타일 디자인 시스템)**을 완벽히 유지하도록 아래 구조를 정확히 구현하세요.

---

### 1. DB 스키마 및 API 구축 (`app.js`)
* **`user_custom_widgets` 테이블 생성:**
  * `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
  * `user_id` (INTEGER NOT NULL, FK `users.id` ON DELETE CASCADE)
  * `title` (TEXT NOT NULL)
  * `description` (TEXT DEFAULT '')
  * `html_code` (TEXT DEFAULT '')
  * `css_code` (TEXT DEFAULT '')
  * `js_code` (TEXT DEFAULT '')
  * `default_w` (INTEGER DEFAULT 4)
  * `default_h` (INTEGER DEFAULT 3)
  * `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
* **커스텀 위젯 CRUD 및 JSON 공유 라우트 추가:**
  * `POST /api/custom-widgets`: 새 커스텀 위젯 생성 (HTML/CSS/JS 코드 및 제목, 기본 크기 저장)
  * `POST /api/custom-widgets/:id/update`: 기존 커스텀 위젯 수정 (`WHERE id = ? AND user_id = ?` 소유권 검증 필수)
  * `POST /api/custom-widgets/:id/delete`: 커스텀 위젯 삭제 및 해당 사용자의 `dashboard_layout` JSON에서도 자동 제거
  * `GET /api/custom-widgets/:id/export`: 공유 가능한 표준 JSON 포맷(`{ format: "WorkSmarter-Widget-v1", title, description, html_code, css_code, js_code, default_w, default_h }`) 반환
  * `POST /api/custom-widgets/import`: 전달받은 JSON 문자열을 검증(필수 필드 확인, 크기 제한 50KB 이하)한 뒤 현재 사용자의 `user_custom_widgets`에 복제 등록

---

### 2. 시각적 일관성 보장: 공용 디자인 시스템 CSS 자동 주입 (`views/index.ejs` & `views/mypage.ejs`)
* 커스텀 위젯은 보안 격리를 위해 반드시 **`<iframe sandbox="allow-scripts">`의 `srcdoc`**으로 렌더링하세요. (절대 부모 페이지의 쿠키나 DOM에 직접 접근할 수 없도록 `allow-same-origin`은 제외)
* `srcdoc`을 조립할 때, 사용자 코드 상단에 **WorkSmarter 공용 스타일시트(Design Tokens + `.ws-*` 컴포넌트 클래스)**를 자동으로 주입하세요:
  * **CSS 변수 토큰:** `--ws-bg: #FFFFFF; --ws-sub-bg: #F7F7F5; --ws-border: #E9E9E7; --ws-text: #37352F; --ws-muted: #787774; --ws-accent: #2383E2; --ws-radius: 6px;`
  * **기본 스타일 리셋:** `body`에 `margin: 0; padding: 12px; font-family: 'Pretendard', -apple-system, sans-serif; color: #37352F; background: #FFFFFF; font-size: 13px; line-height: 1.5;`를 자동 적용하여 별도 CSS를 안 써도 기본 위젯과 글꼴·여백·색상이 똑같이 보이게 설정
  * **공용 유틸리티 클래스 제공:**
    * `.ws-btn` / `.ws-btn-primary` (노션 스타일 단정한 버튼)
    * `.ws-input` (포커스 시 `#2383E2` 테두리가 들어오는 슬림 입력창)
    * `.ws-badge` (은은한 배경의 상태/태그 배지)
    * `.ws-card` (`#F7F7F5` 배경의 내부 서브 박스)
    * `.ws-title` / `.ws-muted` (계층형 타이포그래피)
* **읽기 전용 데이터 브릿지 (`postMessage`):**
  * 부모 대시보드가 `iframe` 로드 완료 시 `window.postMessage({ type: 'WS_CONTEXT', data: { username, todoCount, inProgressCount, doneCount, top3Titles } }, '*')`로 요약 데이터를 전달하여, 커스텀 위젯이 실제 내 일정 데이터를 활용한 동적 위젯(예: 완료율 게이지, D-Day 카드)도 만들 수 있게 지원하세요.

---

### 3. 마이페이지 커스텀 위젯 빌더 & JSON 가져오기/내보내기 UI (`views/mypage.ejs`)
* `views/mypage.ejs`의 `[대시보드 위젯 구성 설정]` 하단에 **`[나만의 커스텀 위젯 관리 & 코드 공유]`** 영역을 추가하세요.
* **주요 UI 구성:**
  1. **`[+ 새 커스텀 위젯 만들기]` 버튼:** 클릭 시 좌측은 **코드 에디터(HTML / CSS / JS 탭)**, 우측은 **실시간 노션 스타일 미리보기(`iframe`)**가 나란히 뜨는 빌더 모달(또는 패널)을 제공하세요.
     * 에디터 상단에 **디자인 가이드 칩(클릭 시 코드 삽입):** `.ws-btn`, `.ws-input`, `.ws-badge`, `.ws-card` 및 **스타터 템플릿 2종(`D-Day 카운터`, `오늘의 완료율 미니 카드`)** 불러오기 버튼을 배치해 누구나 일관된 디자인으로 쉽게 제작할 수 있게 돕습니다.
  2. **`[JSON 코드로 위젯 가져오기]` 버튼:** 다른 사용자가 공유한 위젯 JSON 코드를 붙여넣어 즉시 내 위젯 목록에 설치할 수 있는 입력 모달을 제공하세요.
  3. **내 커스텀 위젯 목록:** 등록된 커스텀 위젯마다 `[대시보드에 표시]` 체크박스, `[코드 공유(JSON 복사)]`, `[수정]`, `[삭제]` 버튼을 제공하세요.

---

### 4. 대시보드 통합 (`views/index.ejs`)
* 사용자가 활성화한 커스텀 위젯(`custom_{id}`)도 기본 위젯들과 똑같이 **GridStack 그리드 배치, `[레이아웃 편집 모드]` 위치·크기 조절, 상단 핸들 바, 그리고 `[팝업 띄우기(PIP)]` 모드**가 동일하게 작동하도록 연결하세요.

수정되는 `app.js`, `views/index.ejs`, `views/mypage.ejs`, `public/style.css`의 전체 변경 사항을 누락 없이 반영해 주세요.
