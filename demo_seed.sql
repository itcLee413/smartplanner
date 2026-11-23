-- MySQL dump 10.13  Distrib 8.4.13, for Linux (x86_64)
--
-- Host: 127.0.0.1    Database: worksmarter
-- ------------------------------------------------------
-- Server version	8.4.13-0ubuntu0.26.04.2

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `notification_logs`
--

DROP TABLE IF EXISTS `notification_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notification_logs`
--

LOCK TABLES `notification_logs` WRITE;
/*!40000 ALTER TABLE `notification_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `link_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `is_read` tinyint DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `schedules`
--

DROP TABLE IF EXISTS `schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `due_datetime` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '개인',
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'TODO',
  `is_top3` tinyint DEFAULT '0',
  `is_important` tinyint DEFAULT '0',
  `is_notified` tinyint DEFAULT '0',
  `focus_minutes` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `schedules_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `schedules`
--

LOCK TABLES `schedules` WRITE;
/*!40000 ALTER TABLE `schedules` DISABLE KEYS */;
INSERT INTO `schedules` VALUES (1,2,'AWS EC2 배포 및 발표자료 최종 리허설','1. 서론: 프로젝트 배경 및 시스템 아키텍처 요약\n2. 본론: EC2 Ubuntu 배포 환경 및 PM2 무중단 구동 시연\n3. 결론: 텔레그램 스마트 비서 실시간 브리핑 데모','2026-11-24 17:00','팀프로젝트','IN_PROGRESS',1,1,0,0,'2026-11-24 05:16:10'),(2,2,'알고리즘 문제 풀이 및 포모도로 4세트','백준/프로그래머스 그래프 탐색(BFS/DFS) 및 DP 기출 3문제 풀이\n포모도로 25분 x 4세트 몰입 집중 실행','2026-11-24 21:00','자기계발','TODO',0,0,0,0,'2026-11-24 05:16:10'),(3,2,'클라우드 컴퓨팅 종합 보고서 제출','GitHub 리포지토리 README.md 배포 가이드 최신화\n동작 영상 링크 첨부 및 PDF 변환 후 과제방 업로드','2026-11-25 14:00','업무','TODO',1,1,0,0,'2026-11-24 05:16:10');
/*!40000 ALTER TABLE `schedules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subtasks`
--

DROP TABLE IF EXISTS `subtasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subtasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `schedule_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_done` tinyint DEFAULT '0',
  `sort_order` int DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `schedule_id` (`schedule_id`),
  CONSTRAINT `subtasks_ibfk_1` FOREIGN KEY (`schedule_id`) REFERENCES `schedules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subtasks`
--

LOCK TABLES `subtasks` WRITE;
/*!40000 ALTER TABLE `subtasks` DISABLE KEYS */;
INSERT INTO `subtasks` VALUES (1,1,'EC2 인스턴스 보안그룹 포트 및 도메인 바인딩 점검',1,0),(2,1,'텔레그램 봇 /link 코드 연동 및 즉시 브리핑 테스트',1,0),(3,1,'발표 슬라이드 10분 타임어택 최종 리허설',0,0),(4,2,'백준 1260번 DFS와 BFS 풀이 및 검증',0,0),(5,2,'백준 2667번 단지번호붙이기 풀이',0,0),(6,2,'오답 노트 정리 및 핵심 시간복잡도 기록',0,0),(7,3,'README.md 내 EC2 배포 명령어 및 환경변수 가이드 검증',1,0),(8,3,'과제 제출 양식 최종 서명 및 PDF 업로드',0,0);
/*!40000 ALTER TABLE `subtasks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_settings`
--

LOCK TABLES `system_settings` WRITE;
/*!40000 ALTER TABLE `system_settings` DISABLE KEYS */;
INSERT INTO `system_settings` VALUES ('bot_enabled','false'),('gemini_api_key',''),('telegram_bot_token','');
/*!40000 ALTER TABLE `system_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `team_invitations`
--

DROP TABLE IF EXISTS `team_invitations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_invitations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` int NOT NULL,
  `inviter_id` int NOT NULL,
  `invitee_id` int NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  KEY `inviter_id` (`inviter_id`),
  KEY `invitee_id` (`invitee_id`),
  CONSTRAINT `team_invitations_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_invitations_ibfk_2` FOREIGN KEY (`inviter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_invitations_ibfk_3` FOREIGN KEY (`invitee_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `team_invitations`
--

LOCK TABLES `team_invitations` WRITE;
/*!40000 ALTER TABLE `team_invitations` DISABLE KEYS */;
/*!40000 ALTER TABLE `team_invitations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `team_members`
--

DROP TABLE IF EXISTS `team_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` int NOT NULL,
  `user_id` int NOT NULL,
  `position` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '팀원',
  `role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'MEMBER',
  `sort_order` int DEFAULT '0',
  `joined_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_team_user` (`team_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `team_members_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_members_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `team_members`
--

LOCK TABLES `team_members` WRITE;
/*!40000 ALTER TABLE `team_members` DISABLE KEYS */;
INSERT INTO `team_members` VALUES (1,1,2,'팀장','LEADER',0,'2026-11-24 05:16:10'),(2,2,1,'팀장','LEADER',0,'2026-11-24 05:18:08');
/*!40000 ALTER TABLE `team_members` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `team_notes`
--

DROP TABLE IF EXISTS `team_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` int NOT NULL,
  `author_id` int NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT '특이사항',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_pinned` tinyint DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  KEY `author_id` (`author_id`),
  CONSTRAINT `team_notes_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_notes_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `team_notes`
--

LOCK TABLES `team_notes` WRITE;
/*!40000 ALTER TABLE `team_notes` DISABLE KEYS */;
INSERT INTO `team_notes` VALUES (1,1,2,'공지','[필독] 게이트웨이 펌웨어 업데이트 시 사전 공지 필수','각 작업 구역 PLC 및 게이트웨이 펌웨어 배포 시 반드시 30분 전 슬랙 및 팀 공지로 알림 후 진행해 주세요. 비인가 포트 개방은 엄격히 금지됩니다.',1,'2026-11-24 05:16:10');
/*!40000 ALTER TABLE `team_notes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `team_schedule_logs`
--

DROP TABLE IF EXISTS `team_schedule_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_schedule_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` int NOT NULL,
  `schedule_id` int DEFAULT NULL,
  `schedule_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `editor_id` int NOT NULL,
  `action_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  KEY `editor_id` (`editor_id`),
  CONSTRAINT `team_schedule_logs_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_schedule_logs_ibfk_2` FOREIGN KEY (`editor_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `team_schedule_logs`
--

LOCK TABLES `team_schedule_logs` WRITE;
/*!40000 ALTER TABLE `team_schedule_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `team_schedule_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `team_schedules`
--

DROP TABLE IF EXISTS `team_schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` int NOT NULL,
  `author_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `due_datetime` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'TODO',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  KEY `author_id` (`author_id`),
  CONSTRAINT `team_schedules_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_schedules_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `team_schedules`
--

LOCK TABLES `team_schedules` WRITE;
/*!40000 ALTER TABLE `team_schedules` DISABLE KEYS */;
INSERT INTO `team_schedules` VALUES (1,1,2,'공장 IoT 센서 디바이스 프로토콜 연동 테스트','Modbus/MQTT 프로토콜 패킷 데이터 수신 검증 및 게이트웨이 지연시간 50ms 이내 유지 테스트','2026-11-24 16:00','IN_PROGRESS','2026-11-24 05:16:10'),(2,1,2,'중간 발표 데모 시나리오 점검 및 네트워크 보안 점검','VPN 망 분리 및 방화벽 인바운드 룰 최종 확인, 시연 동선 및 발표 슬라이드 점검','2026-11-25 15:00','TODO','2026-11-24 05:16:10');
/*!40000 ALTER TABLE `team_schedules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `teams`
--

DROP TABLE IF EXISTS `teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `invite_code` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `invite_code` (`invite_code`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `teams_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `teams`
--

LOCK TABLES `teams` WRITE;
/*!40000 ALTER TABLE `teams` DISABLE KEYS */;
INSERT INTO `teams` VALUES (1,'스마트팩토리 네트워크 구축팀','스마트팩토리 센서 데이터 수집 IoT 게이트웨이 및 실시간 관제 시스템 구축 팀입니다.','SFNET2026',2,'2026-11-24 05:16:10'),(2,'티~원','월즈 우승','Z3978URP',1,'2026-11-24 05:18:08');
/*!40000 ALTER TABLE `teams` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_custom_widgets`
--

DROP TABLE IF EXISTS `user_custom_widgets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_custom_widgets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `html_code` longtext COLLATE utf8mb4_unicode_ci,
  `css_code` longtext COLLATE utf8mb4_unicode_ci,
  `js_code` longtext COLLATE utf8mb4_unicode_ci,
  `default_w` int DEFAULT '4',
  `default_h` int DEFAULT '3',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `user_custom_widgets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_custom_widgets`
--

LOCK TABLES `user_custom_widgets` WRITE;
/*!40000 ALTER TABLE `user_custom_widgets` DISABLE KEYS */;
INSERT INTO `user_custom_widgets` VALUES (1,2,'오늘의 집중 트래커','일일 목표 집중 시간 대비 실시간 경과 시간과 달성률(%)을 추적하는 위젯입니다.','<div class=\"ws-card\"><div class=\"ws-title\">⏱️ 오늘의 집중 트래커</div><div style=\"display: flex; gap: 6px; margin-bottom: 10px;\"><input type=\"text\" id=\"focusTaskName\" class=\"ws-input\" placeholder=\"집중할 작업 (예: 백엔드 API 구현)\" value=\"핵심 작업\"><input type=\"number\" id=\"focusGoalMin\" class=\"ws-input\" style=\"width: 90px;\" placeholder=\"목표(분)\" value=\"60\" min=\"5\" step=\"5\"></div><div style=\"text-align: center; padding: 14px; background: #fff; border-radius: var(--ws-radius); border: 1px solid var(--ws-border);\"><div id=\"focusTimerDisplay\" style=\"font-size: 24px; font-weight: 800; letter-spacing: 1px; color: var(--ws-accent); font-variant-numeric: tabular-nums;\">00:00:00</div><div style=\"margin-top: 8px; display: flex; justify-content: center; align-items: center; gap: 8px;\"><span id=\"focusRateBadge\" class=\"ws-badge\" style=\"font-size: 12px; font-weight: 700; color: var(--ws-accent);\">달성률 0%</span><span id=\"focusStatusText\" class=\"ws-muted\" style=\"font-size: 12px;\">대기 중</span></div><div style=\"width: 100%; height: 6px; background: #eef1f5; border-radius: 999px; overflow: hidden; margin-top: 10px;\"><div id=\"focusProgressBar\" style=\"width: 0%; height: 100%; background: var(--ws-accent); transition: width 0.3s ease;\"></div></div></div><div style=\"margin-top: 10px; display: flex; justify-content: flex-end; gap: 6px;\"><button class=\"ws-btn\" onclick=\"resetFocusTimer()\">초기화</button><button id=\"focusToggleBtn\" class=\"ws-btn ws-btn-primary\" onclick=\"toggleFocusTimer()\">집중 시작</button></div></div>','','var focusSeconds = 0; var focusInterval = null; function formatTime(sec) { var h = String(Math.floor(sec / 3600)).padStart(2, \'0\'); var m = String(Math.floor((sec % 3600) / 60)).padStart(2, \'0\'); var s = String(sec % 60).padStart(2, \'0\'); return h + \':\' + m + \':\' + s; } function updateFocusUI() { var goalMin = Math.max(1, parseInt(document.getElementById(\'focusGoalMin\').value, 10) || 60); var rate = Math.min(100, Math.round((focusSeconds / (goalMin * 60)) * 100)); document.getElementById(\'focusTimerDisplay\').textContent = formatTime(focusSeconds); document.getElementById(\'focusRateBadge\').textContent = \'달성률 \' + rate + \'%\'; document.getElementById(\'focusProgressBar\').style.width = rate + \'%\'; if (rate >= 100) { document.getElementById(\'focusStatusText\').textContent = \'목표 달성 완료!\'; } } function toggleFocusTimer() { var btn = document.getElementById(\'focusToggleBtn\'); var status = document.getElementById(\'focusStatusText\'); var task = document.getElementById(\'focusTaskName\').value.trim() || \'작업\'; if (focusInterval) { clearInterval(focusInterval); focusInterval = null; btn.textContent = \'계속하기\'; status.textContent = \'일시정지됨\'; } else { btn.textContent = \'일시정지\'; status.textContent = task + \' 진행 중...\'; focusInterval = setInterval(function() { focusSeconds++; updateFocusUI(); }, 1000); } } function resetFocusTimer() { if (focusInterval) { clearInterval(focusInterval); focusInterval = null; } focusSeconds = 0; document.getElementById(\'focusToggleBtn\').textContent = \'집중 시작\'; document.getElementById(\'focusStatusText\').textContent = \'대기 중\'; updateFocusUI(); }',4,3,'2026-11-24 05:29:06'),(2,2,'데스크탑 미니 어항','물고기들에게 먹이를 주고 새로운 물고기를 추가하며 잠깐씩 머리를 식히는 힐링 미니 어항입니다.','<div class=\"ws-card\" style=\"padding: 10px;\"><div style=\"display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;\"><div class=\"ws-title\" style=\"margin: 0;\">🐠 미니 어항</div><div style=\"display: flex; gap: 4px;\"><span id=\"fishCountBadge\" class=\"ws-badge\" style=\"font-weight: 700; color: var(--ws-accent);\">물고기 4마리</span></div></div><div style=\"position: relative; width: 100%; border-radius: var(--ws-radius); overflow: hidden; border: 1px solid var(--ws-border);\"><canvas id=\"tankCanvas\" width=\"360\" height=\"165\" style=\"display: block; width: 100%; height: 165px; background: linear-gradient(180deg, #e0f4ff 0%, #b8e4ff 78%, #f3e5ab 78%, #e6d28a 100%);\"></canvas></div><div style=\"margin-top: 8px; display: flex; justify-content: space-between; align-items: center;\"><span id=\"tankMsg\" class=\"ws-muted\" style=\"font-size: 11px;\">어항을 클릭해도 먹이를 줄 수 있어요!</span><div style=\"display: flex; gap: 6px;\"><button class=\"ws-btn\" onclick=\"addNewFish()\" style=\"font-size: 12px;\">🐟 추가</button><button class=\"ws-btn ws-btn-primary\" onclick=\"dropFood()\" style=\"font-size: 12px;\">🍚 먹이 주기</button></div></div></div>','','var canvas = document.getElementById(\'tankCanvas\'); var ctx = canvas.getContext(\'2d\'); var colors = [\'#FF6B6B\', \'#FF9F43\', \'#FECA57\', \'#1DD1A1\', \'#54A0FF\', \'#FF9FF3\']; var fishes = []; var foods = []; var bubbles = []; function createFish(x, y) { return { x: x || (40 + Math.random() * 280), y: y || (30 + Math.random() * 90), vx: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8), vy: (Math.random() - 0.5) * 0.3, size: 7 + Math.random() * 4, color: colors[Math.floor(Math.random() * colors.length)], tailPhase: Math.random() * Math.PI * 2 }; } for (var i = 0; i < 4; i++) { fishes.push(createFish()); } for (var b = 0; b < 8; b++) { bubbles.push({ x: 20 + Math.random() * 320, y: 130 + Math.random() * 30, r: 1.5 + Math.random() * 2, speed: 0.3 + Math.random() * 0.5 }); } function addNewFish() { if (fishes.length >= 15) { document.getElementById(\'tankMsg\').textContent = \'어항이 가득 찼어요! (최대 15마리)\'; return; } fishes.push(createFish()); document.getElementById(\'fishCountBadge\').textContent = \'물고기 \' + fishes.length + \'마리\'; document.getElementById(\'tankMsg\').textContent = \'새 물고기 친구가 입수했습니다!\'; } function dropFood(customX) { var baseX = typeof customX === \'number\' ? customX : (50 + Math.random() * 260); for (var i = 0; i < 4; i++) { foods.push({ x: baseX + (Math.random() - 0.5) * 30, y: 8 + Math.random() * 10, vy: 0.35 + Math.random() * 0.25 }); } document.getElementById(\'tankMsg\').textContent = \'냠냠! 물고기들이 먹이를 찾고 있어요.\'; } canvas.addEventListener(\'click\', function(e) { var rect = canvas.getBoundingClientRect(); var scaleX = canvas.width / rect.width; dropFood((e.clientX - rect.left) * scaleX); }); function drawSeaweed(x, h, phase) { ctx.strokeStyle = \'#2ecc71\'; ctx.lineWidth = 3; ctx.lineCap = \'round\'; ctx.beginPath(); ctx.moveTo(x, 130); for (var y = 130; y >= 130 - h; y -= 5) { var sway = Math.sin((y * 0.08) + phase) * 4; ctx.lineTo(x + sway, y); } ctx.stroke(); } function updateAndDraw() { ctx.clearRect(0, 0, canvas.width, canvas.height); var t = Date.now() * 0.003; drawSeaweed(45, 42, t); drawSeaweed(58, 30, t + 1); drawSeaweed(295, 48, t + 2); drawSeaweed(312, 34, t + 0.5); ctx.fillStyle = \'rgba(255, 255, 255, 0.65)\'; for (var i = 0; i < bubbles.length; i++) { var bu = bubbles[i]; bu.y -= bu.speed; if (bu.y < 10) { bu.y = 132; bu.x = 20 + Math.random() * 320; } ctx.beginPath(); ctx.arc(bu.x, bu.y, bu.r, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = \'#8d5524\'; for (var f = foods.length - 1; f >= 0; f--) { var fd = foods[f]; fd.y += fd.vy; if (fd.y > 128) { foods.splice(f, 1); continue; } ctx.beginPath(); ctx.arc(fd.x, fd.y, 2.3, 0, Math.PI * 2); ctx.fill(); } for (var k = 0; k < fishes.length; k++) { var fish = fishes[k]; fish.tailPhase += 0.18; if (foods.length > 0) { var target = foods[0]; var minDist = 9999; for (var m = 0; m < foods.length; m++) { var dx = foods[m].x - fish.x; var dy = foods[m].y - fish.y; var d = Math.sqrt(dx * dx + dy * dy); if (d < minDist) { minDist = d; target = foods[m]; } } var angle = Math.atan2(target.y - fish.y, target.x - fish.x); fish.vx = Math.cos(angle) * 1.4; fish.vy = Math.sin(angle) * 1.1; if (minDist < fish.size + 4) { var idx = foods.indexOf(target); if (idx > -1) foods.splice(idx, 1); fish.size = Math.min(14, fish.size + 0.25); } } else { fish.vy += (Math.random() - 0.5) * 0.04; fish.vy = Math.max(-0.4, Math.min(0.4, fish.vy)); if (Math.abs(fish.vx) > 0.9) fish.vx *= 0.96; } fish.x += fish.vx; fish.y += fish.vy; if (fish.x < 18) { fish.x = 18; fish.vx = Math.abs(fish.vx); } if (fish.x > canvas.width - 18) { fish.x = canvas.width - 18; fish.vx = -Math.abs(fish.vx); } if (fish.y < 16) { fish.y = 16; fish.vy = Math.abs(fish.vy); } if (fish.y > 118) { fish.y = 118; fish.vy = -Math.abs(fish.vy); } var dir = fish.vx >= 0 ? 1 : -1; ctx.save(); ctx.translate(fish.x, fish.y); ctx.scale(dir, 1); ctx.fillStyle = fish.color; var wag = Math.sin(fish.tailPhase) * 3; ctx.beginPath(); ctx.moveTo(-fish.size * 0.8, 0); ctx.lineTo(-fish.size * 1.6, -fish.size * 0.55 + wag); ctx.lineTo(-fish.size * 1.6, fish.size * 0.55 + wag); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, 0, fish.size, fish.size * 0.58, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = \'#ffffff\'; ctx.beginPath(); ctx.arc(fish.size * 0.45, -fish.size * 0.15, fish.size * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = \'#222222\'; ctx.beginPath(); ctx.arc(fish.size * 0.5, -fish.size * 0.15, fish.size * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } requestAnimationFrame(updateAndDraw); } updateAndDraw();',5,4,'2026-11-24 05:32:38');
/*!40000 ALTER TABLE `user_custom_widgets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_notes`
--

DROP TABLE IF EXISTS `user_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `linked_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'NONE',
  `linked_schedule_id` int DEFAULT NULL,
  `links_json` longtext COLLATE utf8mb4_unicode_ci,
  `attachments_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `user_notes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_notes`
--

LOCK TABLES `user_notes` WRITE;
/*!40000 ALTER TABLE `user_notes` DISABLE KEYS */;
INSERT INTO `user_notes` VALUES (1,1,'새 문서','','NONE',NULL,'[]','[]','2026-11-24 05:22:22','2026-11-24 05:22:22');
/*!40000 ALTER TABLE `user_notes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_top3_team_schedules`
--

DROP TABLE IF EXISTS `user_top3_team_schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_top3_team_schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `team_schedule_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_team_sched` (`user_id`,`team_schedule_id`),
  KEY `team_schedule_id` (`team_schedule_id`),
  CONSTRAINT `user_top3_team_schedules_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_top3_team_schedules_ibfk_2` FOREIGN KEY (`team_schedule_id`) REFERENCES `team_schedules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_top3_team_schedules`
--

LOCK TABLES `user_top3_team_schedules` WRITE;
/*!40000 ALTER TABLE `user_top3_team_schedules` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_top3_team_schedules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'USER',
  `telegram_link_code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telegram_chat_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dashboard_layout` mediumtext COLLATE utf8mb4_unicode_ci,
  `quick_memo` mediumtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin','$2b$10$fXos6cMb.w2sk2JUm9sy6OaXmR9itirpWLGiVIiz8LXoOjHuakPXG','시스템관리자','ADMIN','ADM001',NULL,'[{\"id\":\"top3\",\"x\":0,\"y\":0,\"w\":12,\"h\":3,\"enabled\":true},{\"id\":\"workspace\",\"x\":0,\"y\":3,\"w\":8,\"h\":7,\"enabled\":true},{\"id\":\"stats\",\"x\":8,\"y\":3,\"w\":4,\"h\":4,\"enabled\":true},{\"id\":\"quick_add\",\"x\":8,\"y\":7,\"w\":4,\"h\":3,\"enabled\":true},{\"id\":\"clock\",\"x\":0,\"y\":10,\"w\":2,\"h\":5,\"enabled\":true},{\"id\":\"memo\",\"x\":2,\"y\":10,\"w\":10,\"h\":5,\"enabled\":true}]',NULL,'2026-11-24 05:16:10'),(2,'test','$2b$10$fXos6cMb.w2sk2JUm9sy6OeMceYDh1/wL0m6AV0IEJEQySWiMJ49S','홍길동','USER','TST123',NULL,'[{\"id\":\"top3\",\"x\":0,\"y\":0,\"w\":12,\"h\":3,\"enabled\":true},{\"id\":\"workspace\",\"x\":0,\"y\":3,\"w\":8,\"h\":7,\"enabled\":true},{\"id\":\"stats\",\"x\":8,\"y\":3,\"w\":4,\"h\":4,\"enabled\":true},{\"id\":\"quick_add\",\"x\":8,\"y\":7,\"w\":4,\"h\":3,\"enabled\":true},{\"id\":\"clock\",\"x\":0,\"y\":10,\"w\":4,\"h\":2,\"enabled\":false},{\"id\":\"memo\",\"x\":4,\"y\":10,\"w\":8,\"h\":3,\"enabled\":false},{\"id\":\"custom_1\",\"x\":0,\"y\":10,\"w\":4,\"h\":4,\"enabled\":false},{\"id\":\"custom_2\",\"x\":4,\"y\":10,\"w\":8,\"h\":4,\"enabled\":true}]',NULL,'2026-11-24 05:16:10');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-24  5:42:48
