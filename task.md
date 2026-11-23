# WorkSmarter 팀 협업 및 실시간 알림 기능 구현 (second.md)

이 문서는 `second.md`의 구현 요구사항을 단계별로 추적하고, 세션 간 작업 인수인계가 원활하도록 진행 상황을 기록하는 작업 문서입니다.

---

## 작업 단계 및 진행 현황

- [x] **Phase 1: DB 스키마 신설 및 기초 데이터 모델 구축 (`app.js`)** - [완료]
  - [x] `team_invitations` 테이블 생성 (`id`, `team_id`, `inviter_id`, `invitee_id`, `status`, `created_at`)
  - [x] `notifications` 테이블 생성 (`id`, `user_id`, `type`, `message`, `link_url`, `is_read`, `created_at`)
  - [x] 전역 미들웨어(`res.locals`)를 통한 알림/초대 건수 자동 주입

- [x] **Phase 2: 팀 워크스페이스 '팀 나가기' 기능 구현 (`app.js`, `views/teams.ejs`)** - [완료]
  - [x] `POST /teams/:teamId/leave` 라우트 구현 (권한 검증, 팀장 탈퇴 시 최초 가입자에게 LEADER 자동 위임, 마지막 1인 탈퇴 시 팀 정리)
  - [x] `views/teams.ejs`에 `[팀 나가기]` 버튼 및 `showConfirm` 확인 모달 연동

- [x] **Phase 3: 팀 워크스페이스 전용 '팀 일정 캘린더' 구현 (`views/teams.ejs`, `public/style.css`)** - [완료]
  - [x] `[칸반 뷰]` / `[팀 캘린더 뷰]` 전환 탭 UI 구성
  - [x] 월간 캘린더 그리드 렌더링 (날짜별 팀 일정 조회, 말줄임 규격)
  - [x] 날짜 셀 간 드래그 앤 드롭 이동 및 `due_datetime` 실시간 동기화
  - [x] 기한 미지정 팀 일정 양방향 드래그 앤 드롭
  - [x] 팀 일정 우클릭 메뉴 및 '일정 상세보기' 플로팅 팝오버 연동

- [x] **Phase 4: `@아이디` 기반 팀 초대 발송 기능 (`app.js`, `views/teams.ejs`)** - [완료]
  - [x] `POST /teams/:teamId/invite` 라우트 구현 (`@` 파싱, `username` 검증, 중복 초대/가입 방지, `team_invitations` & `notifications` 생성)
  - [x] `views/teams.ejs` 팀원 관리 영역에 `@아이디` 초대 모달/입력 UI 추가

- [x] **Phase 5: 공통 상단 헤더 알림함 구축 (종 모양 + 빨간 배지 + 드롭다운)** - [완료]
  - [x] `views/partials/notification-dropdown.ejs` 신설
  - [x] 모든 로그인 페이지(`index`, `teams`, `mypage`, `notes`, `admin`) 상단 헤더에 알림 버튼 삽입
  - [x] 카톡 스타일 빨간 숫자 배지 (`#E03E3E`, 미확인 알림 + 대기 중 초대 합계, 0건 시 숨김)
  - [x] 알림 드롭다운 탭: `[팀 일정 알림]` (목록 및 `[모두 읽음 처리]`), `[팀 참여 요청]` (`[수락]` / `[거절]` 버튼)
  - [x] 관련 API 구현 (`POST /api/notifications/read-all`, `POST /api/invitations/:id/respond`)

- [ ] **Phase 6: 전체 통합 테스트 및 검증**
  - [ ] DB 무결성 및 라우트 예외 처리 검증
  - [ ] 팀 캘린더 DnD, 팀 나가기 위임, @초대, 알림함 수락/거절 시나리오 테스트
