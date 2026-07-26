# 📅 Simple Schedule Picker (약속날짜 잡기)

> 가입 없이, 링크 하나로 지인들과 실시간으로 약속 날짜를 조율하는 웹 앱

**Live Demo**: [GitHub Pages 배포 주소]  
**Repository**: [https://github.com/tg383520/SchedulePicker](https://github.com/tg383520/SchedulePicker)

---

## 📖 프로젝트 개요

**Simple Schedule Picker**는 Doodle, When2Meet과 유사한 일정 조율 도구입니다.  
별도의 회원가입이나 설치 없이 링크를 공유하는 것만으로, 여러 사람이 동시에 가능한 날짜를 선택하고 겹치는 날짜를 실시간으로 확인할 수 있습니다.

### 🎯 개발 목적

- **마찰 없는 사용성**: 회원가입, 앱 설치, 로그인이 전혀 필요 없습니다. 링크를 받은 사람이면 누구나 즉시 참여 가능합니다.
- **실시간 협업**: 여러 명이 동시에 접속해도 서로의 선택이 실시간으로 반영됩니다.
- **가벼운 아키텍처**: 백엔드 서버 없이 Supabase의 PostgreSQL + Realtime 기능만으로 운영됩니다.
- **개인 프로젝트 학습**: 순수 Vanilla JS + Supabase Realtime 조합으로 실시간 멀티유저 앱의 핵심 패턴(상태 관리, 레이스 컨디션 처리, 낙관적 업데이트)을 학습하기 위해 개발하였습니다.

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| **방 생성** | 약속 이름을 입력하고 버튼 하나로 새로운 방(Room)을 생성합니다. |
| **링크 공유** | 생성된 방의 URL을 복사해 지인들에게 공유합니다. |
| **이름 등록** | 방에 입장 시 참여 이름을 입력하면 자동으로 고유 색상이 부여됩니다. |
| **날짜 클릭 선택** | 달력에서 날짜를 클릭하면 해당 날짜에 참여 가능 표시를 토글합니다. |
| **날짜 드래그 선택** | 달력을 마우스로 드래그하면 여러 날짜를 한 번에 선택할 수 있습니다. |
| **실시간 동기화** | 한 참가자가 날짜를 선택하면 다른 참가자의 화면에 즉시 반영됩니다. |
| **추천 날짜** | 가장 많은 사람이 선택한 날짜 최대 5개를 자동으로 추천합니다. (2명 이상 조건) |
| **방장 권한** | 방을 만든 사람(방장)은 👑 아이콘으로 표시되며 다른 참가자를 삭제할 수 있습니다. |
| **다크/라이트 테마** | Light / Dark / System 세 가지 테마를 지원합니다. |
| **로컬 모드** | Supabase 없이도 같은 브라우저의 여러 탭 간에 테스트 가능한 로컬 모드를 지원합니다. |

---

## 🗂️ 프로젝트 구조

```
SchedulePicker/
├── index.html        # 앱의 뼈대가 되는 단일 HTML 파일
├── style.css         # 전체 스타일 (CSS 변수 기반 테마 시스템 포함)
├── app.js            # 앱의 전체 로직 (상태 관리, 렌더링, 동기화)
├── config.js         # Supabase 접속 설정 (URL, Anon Key, 로컬 모드 플래그)
├── server.py         # 로컬 테스트용 Python HTTP 서버 (캐시 무효화 헤더 포함)
└── readme.md         # 이 파일
```

### 파일별 역할 상세

#### `index.html`
- 앱 전체의 DOM 구조를 정의하는 단일 HTML 파일 (SPA 방식)
- 두 개의 "화면"(`#home-screen`, `#room-screen`)으로 구성
  - `#home-screen`: 방 생성 UI (약속 이름 입력 + 방 만들기 버튼)
  - `#room-screen`: 방 내부 UI (달력, 참가자 목록, 추천 날짜)
- 화면 전환은 CSS class(`active`)로 제어하며 페이지 리로드 없음
- 외부 의존성: Supabase JS SDK (CDN), Google Fonts (Inter)

#### `style.css`
- **CSS 변수 기반 테마 시스템**: `:root` (라이트)와 `.theme-dark` (다크) 두 세트의 색상 변수
- 반응형 레이아웃: 좌측 달력 + 우측 사이드바 구성 (`grid`/`flex`)
- 글라스모피즘 스타일의 카드 UI (`backdrop-filter: blur`)
- 달력 셀, 참가자 목록, 추천 날짜 등 컴포넌트별 스타일 분리

#### `app.js`
앱의 핵심 로직이 담긴 가장 중요한 파일입니다. 세 가지 영역으로 나뉩니다.

**1. 전역 상태 (`state` 객체)**
```javascript
let state = {
    roomId: null,               // URL 파라미터에서 읽어온 방 ID (UUID)
    roomName: '',               // 방 이름
    participants: [],           // [{ id, name, color }] 전체 참가자 배열
    selections: {},             // { "YYYY-MM-DD": ["participantId", ...] } 날짜별 선택 현황
    currentMonth: new Date(),   // 달력에 표시 중인 연/월
    myParticipantId: null,      // localStorage에 저장된 나의 참가자 ID
    isHost: false,              // 방 생성자(방장) 여부 (localStorage 기반)
    hostId: null,               // DB에 저장된 방장의 participant ID
};
```

**2. `syncManager` 객체 — 데이터 동기화의 핵심**

모든 데이터 읽기/쓰기가 이 객체를 통해 처리됩니다.

| 메서드 | 역할 |
|--------|------|
| `init(roomId)` | 모드(Supabase/로컬)에 따라 초기화, Supabase Realtime 구독 시작 |
| `handleIncomingState(newState)` | 서버/다른 탭에서 받은 데이터를 현재 상태에 **병합** |
| `fetchFromSupabase(roomId)` | Supabase에서 방 데이터 최초 로드 |
| `broadcast()` | 200ms 디바운스 후 DB에 현재 상태 저장 (빠른 입력 통합) |
| `broadcastImmediate()` | 즉시 DB에 저장 (디바운스 없음) |

**3. 렌더 함수들**

| 함수 | 역할 |
|------|------|
| `renderCalendar()` | 달력 전체를 DOM으로 생성 (월 변경 시에만 호출) |
| `updateCellUI(dateStr)` | 특정 날짜 셀의 색상 바만 교체 (DOM 재생성 없음) |
| `updateAllCellsUI()` | 전체 셀 UI를 일괄 갱신 (DOM 재생성 없음, 깜빡임 방지) |
| `applyDragAction(dateStr)` | 클릭/드래그 시 날짜 선택/해제 처리 |
| `renderParticipants()` | 참가자 목록 렌더링 (방장 👑 표시, 삭제 버튼) |
| `renderRecommendations()` | 추천 날짜 목록 렌더링 (2인 이상 조건 필터) |

#### `config.js`
```javascript
const CONFIG = {
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'your-anon-key',
    LOCAL_MODE_ONLY: false  // true로 변경 시 로컬 모드로 전환
};
```
> ⚠️ **주의**: `SUPABASE_ANON_KEY`는 Supabase의 공개 키(anon/public key)입니다.  
> 서버사이드 비밀 키(service_role key)와 혼동하지 않도록 주의하세요.

#### `server.py`
- 로컬 테스트용 Python 3 간이 HTTP 서버 (포트 3000)
- 모든 응답에 `Cache-Control: no-cache, no-store` 헤더를 추가하여 브라우저 캐싱으로 인한 코드 변경 미반영 문제를 방지합니다.

```bash
python server.py
# http://localhost:3000 에서 앱 확인
```

---

## 🏗️ 기술 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                         브라우저 (클라이언트)                    │
│                                                              │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │  index.html │    │   style.css   │    │    app.js      │  │
│  │  (DOM 구조) │◄───│  (스타일)    │    │  (상태+로직)   │  │
│  └─────────────┘    └──────────────┘    └───────┬────────┘  │
│                                                 │           │
│                              ┌──────────────────┤           │
│                              │   syncManager    │           │
│                              │  (동기화 담당)   │           │
│                              └──────┬──┬────────┘           │
└─────────────────────────────────────┼──┼────────────────────┘
                                      │  │
          ┌───────────────────────────┘  └────────────────────┐
          │  Supabase (클라우드)              로컬 모드 (테스트) │
          │  ┌─────────────────────┐         ┌──────────────┐  │
          │  │   PostgreSQL DB      │         │ localStorage │  │
          │  │   (rooms 테이블)     │         │ BroadcastCh. │  │
          │  │                     │         └──────────────┘  │
          │  │   Realtime Engine   │                           │
          │  │  (WebSocket 구독)   │                           │
          │  └─────────────────────┘                           │
          └───────────────────────────────────────────────────┘
```

### 데이터 흐름

1. **방 생성**: 방장이 방을 만들면 UUID를 생성하고 Supabase `rooms` 테이블에 초기 상태(`participants: [], selections: {}`)를 INSERT합니다.
2. **방 입장**: URL의 `?room=UUID` 파라미터를 읽어 Supabase에서 방 데이터를 FETCH합니다.
3. **날짜 선택**: 사용자가 날짜를 클릭/드래그하면 로컬 `state.selections`를 즉시 업데이트하고 (`applyDragAction`), 200ms 디바운스 후 Supabase에 UPSERT합니다 (`syncManager.broadcast`).
4. **실시간 수신**: Supabase Realtime이 DB 변경을 WebSocket으로 모든 구독자에게 PUSH합니다 (`postgres_changes` 이벤트).
5. **상태 병합**: 수신한 데이터는 `handleIncomingState`에서 처리됩니다. **나의 선택은 절대 서버 데이터로 덮어쓰지 않고**, 다른 참가자의 선택만 병합합니다.

---

## 🔑 핵심 기술적 의사결정 및 문제 해결 과정

이 섹션은 개발 중 만났던 어려운 문제들과 그 해결 방법을 기록합니다.

### 1. 실시간 레이스 컨디션(Race Condition) 문제

**문제**: 사용자가 날짜를 빠르게 연속으로 클릭하거나 드래그하면, 선택한 날짜가 깜빡이거나 취소되는 현상이 발생했습니다.

**원인 분석**:
- **레이스 컨디션**: 사용자가 5번 클릭하는 동안 1번째 클릭에 대한 서버 응답이 뒤늦게 도착하면, "1번 클릭 상태"가 "5번 클릭 상태"를 덮어씁니다.
- **PostgreSQL jsonb 키 순서**: PostgreSQL의 `jsonb` 타입은 JSON 키를 알파벳 순으로 정렬하여 저장합니다. JavaScript의 `JSON.stringify`와 비교 시 항상 달라 보여서, 변경이 없음에도 UI를 다시 렌더링하는 문제가 있었습니다.
- **DOM 재생성**: `grid.innerHTML = ''`으로 달력 전체를 지우고 다시 만들면, 수십 개의 DOM 노드가 한 번에 제거/추가되어 시각적 깜빡임이 발생합니다.

**해결책**:

```javascript
// handleIncomingState 내부 — 나의 선택은 로컬 state를 권위(source of truth)로 사용
const myId = state.myParticipantId;
const mergedSelections = {};

// 1. 내 로컬 선택 상태를 먼저 유지
for (const date in state.selections) {
    if (myId && state.selections[date].includes(myId)) {
        mergedSelections[date] = [myId];
    }
}

// 2. 다른 참가자들의 상태만 서버 데이터에서 가져와 병합
for (const date in newState.selections) {
    remoteSelected.forEach(pId => {
        if (pId !== myId) mergedSelections[date].push(pId);
    });
}
```

```javascript
// areSelectionsEqual — JSON.stringify 대신 키 순서 무관 비교
function areSelectionsEqual(s1, s2) {
    // 두 selections가 의미적으로 같은지 비교 (키 순서 무관)
    const arr1 = s1[k].slice().sort();
    const arr2 = s2[k].slice().sort();
    // ...
}
```

```javascript
// updateCellUI — innerHTML='' 대신 bars만 교체
function updateCellUI(dateStr) {
    const barsContainer = cell.querySelector('.bars-container');
    barsContainer.innerHTML = ''; // bars만 지우고 셀 자체는 유지
    // ...
}
```

### 2. 클릭 vs 드래그 선택 간섭 문제

**문제**: 클릭으로 날짜를 선택할 때와 드래그로 여러 날짜를 선택할 때의 이벤트가 서로 간섭하여 의도치 않은 동작이 발생했습니다.

**해결책**:
- 브라우저의 기본 드래그 선택 동작(`dragstart`)을 `preventDefault()`로 차단합니다.
- `.calendar-cell`에 `user-select: none`을 CSS로 지정하여 텍스트 드래그 선택을 방지합니다.
- `isMouseDown`, `isDragging`, `dragAction`(`'select'` | `'deselect'`) 세 가지 전역 플래그로 현재 상호작용 상태를 추적합니다.
- `mousedown` 시 첫 셀의 현재 상태(선택됨/해제됨)에 따라 드래그 전체의 방향(`dragAction`)을 결정합니다. 이후 `mouseenter` 이벤트에서 같은 방향으로만 적용합니다.

### 3. 방장 식별 및 권한 관리

**문제**: 방장 정보를 어떻게 저장하고, 브라우저가 닫혔다가 열려도 방장임을 식별할 수 있게 할 것인가.

**해결책**:
- 방 생성 시 `localStorage.setItem('host_' + roomId, 'true')`로 로컬에 방장 토큰을 저장합니다.
- 방장의 `myParticipantId`를 `hostId`로 DB(`state.hostId`)에 저장합니다.
- 렌더링 시 `state.hostId === p.id`인 참가자 옆에 👑을 표시합니다.
- `state.isHost`(로컬 토큰)와 `state.hostId`(DB 저장 값)를 분리하여, 방장 여부(UI 권한)와 방장 ID(표시)를 독립적으로 관리합니다.

---

## 🗄️ 데이터베이스 스키마

Supabase PostgreSQL의 `rooms` 테이블 하나로 운영됩니다.

```sql
CREATE TABLE rooms (
    id   UUID PRIMARY KEY,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

`state` JSONB 컬럼의 구조:

```json
{
  "roomName": "연말 모임",
  "hostId": "a1b2c3d4-...",
  "participants": [
    { "id": "a1b2c3d4-...", "name": "철수", "color": "#3b82f6" },
    { "id": "e5f6g7h8-...", "name": "영희", "color": "#ef4444" }
  ],
  "selections": {
    "2025-12-24": ["a1b2c3d4-...", "e5f6g7h8-..."],
    "2025-12-25": ["a1b2c3d4-..."]
  }
}
```

### 데이터 생명주기 관리 (pg_cron)

Supabase의 `pg_cron` 확장을 사용하여 **30일 이상 업데이트되지 않은 방을 자동 삭제**합니다.

```sql
-- 매일 새벽 3시 실행
SELECT cron.schedule(
  'delete-old-rooms',
  '0 3 * * *',
  $$DELETE FROM rooms WHERE updated_at < NOW() - INTERVAL '30 days';$$
);
```

---

## 🔒 보안 고려사항

| 항목 | 현황 | 설명 |
|------|------|------|
| **Supabase Anon Key 노출** | ✅ 의도된 공개 | Anon Key는 Supabase의 공개 클라이언트 키입니다. 기능을 제한하는 RLS 정책과 함께 사용하도록 설계되어 있으며, 비밀 키(service_role)는 절대 클라이언트에 노출하지 않습니다. |
| **무인증 방 접근** | ✅ 의도적 설계 | 링크 공유 기반 서비스이므로 별도 인증을 두지 않습니다. 방 ID가 UUID이므로 무작위 추측은 사실상 불가능합니다. |
| **DDoS / API 남용 방지** | 🔶 부분 적용 | 클라이언트 측 200ms 디바운싱으로 불필요한 API 호출을 줄입니다. Supabase 프로젝트의 Rate Limit 설정을 활용합니다. |
| **데이터 영구 보관** | ✅ 자동 삭제 | `pg_cron`으로 30일 이상 오래된 방은 자동 삭제됩니다. |
| **방장 검증** | 🔶 localStorage 기반 | 방장 권한은 브라우저 localStorage에 저장됩니다. 개발 편의 중심 앱이므로 별도 서버 검증은 없습니다. |

---

## 🚀 로컬 실행 방법

### 1. 저장소 클론

```bash
git clone https://github.com/tg383520/SchedulePicker.git
cd SchedulePicker
```

### 2. Supabase 설정 (선택)

**Supabase 없이 로컬 테스트**를 원한다면 `config.js`를 다음과 같이 설정합니다:

```javascript
const CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    LOCAL_MODE_ONLY: true  // 로컬 모드 활성화
};
```

로컬 모드에서는 같은 브라우저의 여러 탭 간에 BroadcastChannel + localStorage로 통신합니다.

**Supabase를 사용**하려면 [supabase.com](https://supabase.com)에서 프로젝트를 생성하고:

```sql
-- Supabase SQL Editor에서 실행
CREATE TABLE rooms (
    id   UUID PRIMARY KEY,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
```

그리고 `config.js`에 프로젝트 URL과 Anon Key를 입력합니다.

### 3. 서버 실행

```bash
python server.py
```

브라우저에서 `http://localhost:3000` 접속

---

## 🛣️ 개발 로드맵 (향후 계획)

- [ ] 모바일 터치 이벤트 지원 (핀치/스와이프 날짜 선택)
- [ ] 날짜별 메모/댓글 기능
- [ ] iCal / Google Calendar 내보내기 (`.ics` 파일)
- [ ] 방 마감 시간 설정 및 알림
- [ ] 커스텀 도메인 연결 (GitHub Pages CNAME)

---

## 🧑‍💻 개발 과정 타임라인

| 단계 | 내용 |
|------|------|
| **v0.1 — 기반 구축** | 순수 HTML/CSS/JS로 달력 UI 및 기본 방 생성/참여 기능 구현 |
| **v0.2 — Supabase 연동** | PostgreSQL `rooms` 테이블 + Realtime WebSocket으로 멀티탭 동기화 |
| **v0.3 — 방장 시스템** | `hostId` 저장, 👑 왕관 아이콘, 방장 자기삭제 방지, 참가자 추방 기능 |
| **v0.4 — UX 개선** | 날짜 선택 시 아우라 효과 제거, 1인 추천 날짜 숨김, 다크 테마 지원 |
| **v0.5 — 드래그 선택** | 마우스 드래그로 연속 날짜 일괄 선택/해제 기능 추가 |
| **v0.6 — 레이스 컨디션 해결** | 로컬 상태 보존 병합 로직, `areSelectionsEqual`, `updateCellUI`, 200ms 디바운스로 빠른 클릭/드래그 깜빡임 문제 완전 해결 |

---

## 🛠️ 기술 스택

| 구분 | 기술 |
|------|------|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| **Database** | Supabase PostgreSQL (JSONB) |
| **Realtime** | Supabase Realtime (WebSocket `postgres_changes`) |
| **Hosting** | GitHub Pages |
| **Fonts** | Google Fonts — Inter |
| **Local Test** | Python 3 (http.server), BroadcastChannel API, localStorage |

---

## 📄 라이선스

MIT License — 자유롭게 사용, 수정, 배포 가능합니다.
