// app.js

// State
let state = {
    roomId: null,
    roomName: '',
    participants: [], // { id: string, name: string, color: string }
    selections: {}, // { "YYYY-MM-DD": ["participantId", ...] }
    currentMonth: new Date(),
    myParticipantId: null,
    isHost: false,
    hostId: null, // DB에 저장되는 방장의 participant ID
};

let isMouseDown = false;
let isDragging = false;
let dragAction = null;

// JSON 키 순서와 상관없이 selections 데이터가 동일한지 비교하는 함수
function areSelectionsEqual(s1, s2) {
    if (!s1 || !s2) return s1 === s2;
    const keys1 = Object.keys(s1);
    const keys2 = Object.keys(s2);
    if (keys1.length !== keys2.length) return false;
    for (const k of keys1) {
        if (!s2[k]) return false;
        if (s1[k].length !== s2[k].length) return false;
        const arr1 = s1[k].slice().sort();
        const arr2 = s2[k].slice().sort();
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) return false;
        }
    }
    return true;
}

// Colors for participants
const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];
const getColor = (id) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return COLORS[Math.abs(hash) % COLORS.length];
};

// UUID - Safe fallback for insecure contexts (e.g., testing on mobile via local IP)
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

function showError(msg) {
    const banner = document.getElementById('error-banner');
    if (banner) {
        banner.style.display = 'block';
        banner.textContent += '❌ ' + msg + '\n';
    }
    console.error(msg);
}

// Global error handler
window.onerror = function (msg, url, line) {
    showError("JS 오류: " + msg + " (줄: " + line + ")");
};
// async 함수 내부 에러도 잡기
window.onunhandledrejection = function (event) {
    showError("Async 오류: " + (event.reason && event.reason.message ? event.reason.message : event.reason));
};

// Initialize Supabase Client
if (typeof supabase === 'undefined') {
    var supabase = null;
}
try {
    if (typeof CONFIG === 'undefined') {
        showError("config.js 파일을 읽을 수 없습니다. 오타나 빠진 따옴표가 없는지 확인해주세요.");
    } else if (!CONFIG.LOCAL_MODE_ONLY && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
        if (window.supabase) {
            supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        } else {
            showError("Supabase 스크립트를 불러오지 못했습니다. 네트워크 연결 상태를 확인해주세요.");
        }
    }
} catch (e) {
    showError("Supabase 초기화 에러:\n" + e.message);
}

// Sync Manager (Handles LocalStorage, BroadcastChannel, and Supabase)
const syncManager = {
    channel: null,
    broadcastTimeout: null,

    init: function (roomId) {
        if (CONFIG.LOCAL_MODE_ONLY || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
            console.log("Running in Local Mode (BroadcastChannel + LocalStorage)");
            try {
                this.channel = new BroadcastChannel('room_' + roomId);
                this.channel.onmessage = (event) => {
                    const data = event.data;
                    if (data.type === 'sync') {
                        this.handleIncomingState(data.state);
                    }
                };
            } catch (e) {
                console.warn("BroadcastChannel not supported.");
            }

            window.addEventListener('storage', (e) => {
                if (e.key === 'room_' + roomId) {
                    const data = JSON.parse(e.newValue);
                    if (data) {
                        this.handleIncomingState(data);
                    }
                }
            });

            const stored = localStorage.getItem('room_' + roomId);
            if (stored) {
                const data = JSON.parse(stored);
                state.participants = data.participants || [];
                state.selections = data.selections || {};
                state.roomName = data.roomName || '약속날짜 조율';
                state.hostId = data.hostId || null;
            }
        } else {
            console.log("Supabase Mode: Initializing...");

            this.fetchFromSupabase(roomId);

            supabase
                .channel('room_updates_' + roomId)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, payload => {
                    const newState = payload.new.state;
                    if (newState) {
                        this.handleIncomingState(newState);
                    }
                })
                .subscribe();
        }
    },

    handleIncomingState: function (newState) {
        // 사용자가 마우스를 누르거나 드래그 중일 때는 외부 수신 데이터로 덮어쓰지 않음
        if (isMouseDown) return;

        const myId = state.myParticipantId;
        const mergedSelections = {};

        // 내 로컬 선택 상태 유지 (빠른 클릭/드래그 시 서버 딜레이로 인한 레이스 조건 및 깜빡임 방지)
        for (const date in state.selections) {
            if (myId && state.selections[date].includes(myId)) {
                mergedSelections[date] = [myId];
            }
        }

        // 다른 참가자들의 선택 상태 병합
        if (newState.selections) {
            for (const date in newState.selections) {
                const remoteSelected = newState.selections[date] || [];
                if (!mergedSelections[date]) {
                    mergedSelections[date] = [];
                }
                remoteSelected.forEach(pId => {
                    if (pId !== myId && !mergedSelections[date].includes(pId)) {
                        mergedSelections[date].push(pId);
                    }
                });
            }
        }

        // 빈 배열 정리
        for (const date in mergedSelections) {
            if (mergedSelections[date].length === 0) {
                delete mergedSelections[date];
            }
        }

        const isSameSelections = areSelectionsEqual(state.selections, mergedSelections);
        const isSameParticipants = JSON.stringify(state.participants) === JSON.stringify(newState.participants);
        const isSameHost = state.hostId === (newState.hostId || null);
        const isSameRoomName = state.roomName === newState.roomName;

        if (isSameSelections && isSameParticipants && isSameHost && isSameRoomName) {
            return; // 내용이 완전히 같으면 UI 재렌더링 무시 (깜빡임 0)
        }

        const participantsChanged = !isSameParticipants || !isSameHost;

        state.participants = newState.participants || [];
        state.selections = mergedSelections;
        state.roomName = newState.roomName || state.roomName;
        state.hostId = newState.hostId || null;

        if (participantsChanged) {
            renderParticipants();
        }

        // 전체 캘린더를 지우지(innerHTML = '') 않고 셀 UI만 부드럽게 업데이트
        updateAllCellsUI();
        renderRecommendations();
    },

    fetchFromSupabase: async function (roomId) {
        if (!supabase) return;
        const { data, error } = await supabase.from('rooms').select('state').eq('id', roomId).single();
        if (data && data.state) {
            state.participants = data.state.participants || [];
            state.selections = data.state.selections || {};
            state.roomName = data.state.roomName || state.roomName;
            state.hostId = data.state.hostId || null;

            if (state.isHost && state.myParticipantId && !state.hostId) {
                state.hostId = state.myParticipantId;
                this.broadcastImmediate();
            }

            document.getElementById('display-room-name').textContent = state.roomName;
            renderParticipants();
            renderCalendar();
            renderRecommendations();
        }
    },

    broadcast: function () {
        if (this.broadcastTimeout) {
            clearTimeout(this.broadcastTimeout);
        }
        // 빠른 연타/드래그 통신 폭주 방지를 위해 200ms 디바운스 적용
        this.broadcastTimeout = setTimeout(() => {
            this.broadcastImmediate();
        }, 200);
    },

    broadcastImmediate: async function () {
        if (this.broadcastTimeout) {
            clearTimeout(this.broadcastTimeout);
            this.broadcastTimeout = null;
        }
        const dataToSync = {
            participants: state.participants,
            selections: state.selections,
            roomName: state.roomName,
            hostId: state.hostId
        };

        if (CONFIG.LOCAL_MODE_ONLY || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
            if (this.channel) this.channel.postMessage({ type: 'sync', state: dataToSync });
            localStorage.setItem('room_' + state.roomId, JSON.stringify(dataToSync));
        } else {
            if (supabase && state.roomId) {
                const { error } = await supabase.from('rooms').upsert({ id: state.roomId, state: dataToSync });
                if (error) showError("broadcast 실패: " + error.message);
            }
        }
    }
};

// Application Init
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
    setupTheme();
});

function initApp() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');

    if (roomId) {
        state.roomId = roomId;
        document.getElementById('home-screen').classList.remove('active');
        document.getElementById('room-screen').classList.add('active');

        // Load local user settings
        state.myParticipantId = localStorage.getItem('my_id_' + roomId);
        state.isHost = localStorage.getItem('host_' + roomId) === 'true';

        syncManager.init(roomId);

        if (state.myParticipantId) {
            document.getElementById('join-form').classList.add('hidden');
            document.getElementById('my-status').classList.remove('hidden');
            const me = state.participants.find(p => p.id === state.myParticipantId);
            if (me) {
                document.getElementById('my-display-name').textContent = me.name;

                // 내가 방장인데 DB 상에 hostId가 없다면 등록 후 브로드캐스트
                if (state.isHost && !state.hostId) {
                    state.hostId = state.myParticipantId;
                    syncManager.broadcast();
                }
            } else {
                // Not in the room participants anymore (kicked or deleted)
                state.myParticipantId = null;
                localStorage.removeItem('my_id_' + roomId);
                document.getElementById('join-form').classList.remove('hidden');
                document.getElementById('my-status').classList.add('hidden');
            }
        }

        if (state.isHost) {
            document.getElementById('host-badge').classList.remove('hidden');
        }

        document.getElementById('display-room-name').textContent = state.roomName || '새로운 약속';

        state.currentMonth.setDate(1); // Set to 1st of month to avoid overflow bugs

        renderParticipants();
        renderCalendar();
        renderRecommendations();
    } else {
        document.getElementById('home-screen').classList.add('active');
        document.getElementById('room-screen').classList.remove('active');
    }
}

function setupEventListeners() {
    // Home: Create Room
    document.getElementById('create-room-btn').addEventListener('click', async () => {
        try {
            const name = document.getElementById('room-name-input').value.trim() || '새로운 약속';
            const newRoomId = generateUUID();

            // Save host token
            localStorage.setItem('host_' + newRoomId, 'true');

            const initialState = {
                roomName: name,
                participants: [],
                selections: {}
            };

            if (supabase) {
                // Save initial state to Supabase
                const { error } = await supabase.from('rooms').insert({ id: newRoomId, state: initialState });
                if (error) {
                    showError("방 생성 실패 (Supabase 문제):\n" + error.message);
                    return; // 방 생성이 실패했으므로 페이지 이동 중단
                }
            } else {
                // Save initial state for local mode
                localStorage.setItem('room_' + newRoomId, JSON.stringify(initialState));
            }

            window.location.href = `?room=${newRoomId}`;
        } catch (err) {
            showError("방 만들기 오류:\n" + err.message);
        }
    });

    // Room: Copy Link
    document.getElementById('copy-link-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            const btn = document.getElementById('copy-link-btn');
            const originalText = btn.textContent;
            btn.textContent = '복사 완료!';
            btn.style.backgroundColor = 'var(--success-color)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = '';
            }, 2000);
        });
    });

    // Global mouseup listener for drag and click select
    window.addEventListener('mouseup', () => {
        if (isMouseDown) {
            isMouseDown = false;
            isDragging = false;
            dragStartCell = null;
            dragAction = null;
            // 200ms 디바운스를 통해 빠른 연속 클릭/드래그 시에도 네트워크 요청을 1회로 통합
            syncManager.broadcast();
        }
    });

    // Global touchmove listener — 손가락이 어느 셀 위에 있는지 elementFromPoint로 탐색
    window.addEventListener('touchmove', (e) => {
        if (!isMouseDown) return;
        isDragging = true;
        const touch = e.touches[0];
        // 현재 손가락 위치의 최상위 요소 탐색
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        // .calendar-cell[data-date] 또는 그 자식(date-num, bars-container 등)
        const cell = el && (el.closest('.calendar-cell[data-date]') || (el.dataset && el.dataset.date ? el : null));
        if (cell && cell.dataset.date) {
            applyDragAction(cell.dataset.date);
        }
    }, { passive: true });

    // Global touchend listener — mouseup과 동일한 역할
    window.addEventListener('touchend', () => {
        if (isMouseDown) {
            isMouseDown = false;
            isDragging = false;
            dragStartCell = null;
            dragAction = null;
            syncManager.broadcast();
        }
    });

    // touchcancel도 처리 (전화 수신 등으로 터치가 강제 종료될 때)
    window.addEventListener('touchcancel', () => {
        if (isMouseDown) {
            isMouseDown = false;
            isDragging = false;
            dragStartCell = null;
            dragAction = null;
            syncManager.broadcast();
        }
    });

    // Room: Join
    document.getElementById('join-room-btn').addEventListener('click', () => {
        const name = document.getElementById('participant-name-input').value.trim();
        if (!name) return;

        const newId = generateUUID();
        const color = getColor(newId);

        state.participants.push({ id: newId, name, color });
        state.myParticipantId = newId;

        localStorage.setItem('my_id_' + state.roomId, newId);

        // 내가 방장인 경우 hostId로 지정
        if (state.isHost) {
            state.hostId = newId;
        }

        document.getElementById('join-form').classList.add('hidden');
        document.getElementById('my-status').classList.remove('hidden');
        document.getElementById('my-display-name').textContent = name;

        syncManager.broadcast();
        renderParticipants();
    });

    // Calendar navigation
    document.getElementById('prev-month').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('next-month').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
        renderCalendar();
    });
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();

    document.getElementById('current-month-year').textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Empty cells before start
    for (let i = 0; i < firstDay; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell empty';
        grid.appendChild(cell);
    }

    // Days
    for (let i = 1; i <= daysInMonth; i++) {
        const cell = document.createElement('div');
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const cellDate = new Date(year, month, i);

        cell.className = 'calendar-cell';
        cell.dataset.date = dateStr; // data-date 추가
        if (cellDate < today) cell.classList.add('past-date');

        const numSpan = document.createElement('span');
        numSpan.className = 'date-num';
        numSpan.textContent = i;
        cell.appendChild(numSpan);

        const barsContainer = document.createElement('div');
        barsContainer.className = 'bars-container';

        const selectedBy = state.selections[dateStr] || [];

        selectedBy.forEach(pId => {
            const p = state.participants.find(x => x.id === pId);
            if (p) {
                const bar = document.createElement('div');
                bar.className = 'bar';
                bar.style.backgroundColor = p.color;
                if (pId === state.myParticipantId) {
                    bar.classList.add('my-selection');
                    cell.classList.add('selected-by-me');
                }
                barsContainer.appendChild(bar);
            }
        });

        cell.appendChild(barsContainer);

        // 마우스 클릭 및 드래그 선택 기능 구현
        if (cellDate >= today) {
            // --- 마우스 (PC) ---
            cell.addEventListener('mousedown', (e) => {
                if (!state.myParticipantId) {
                    alert('먼저 이름을 입력하고 참여해주세요!');
                    const input = document.getElementById('participant-name-input');
                    if (input) input.focus();
                    return;
                }
                isMouseDown = true;
                isDragging = false;
                dragStartCell = dateStr;

                const selectedBy = state.selections[dateStr] || [];
                const isSelected = selectedBy.includes(state.myParticipantId);
                dragAction = isSelected ? 'deselect' : 'select';

                applyDragAction(dateStr);
                e.preventDefault(); // 텍스트 블록 지정 방지
            });

            cell.addEventListener('mouseenter', () => {
                if (isMouseDown) {
                    isDragging = true;
                    applyDragAction(dateStr);
                }
            });

            cell.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });

            // --- 터치 (모바일/태블릿) ---
            cell.addEventListener('touchstart', (e) => {
                if (!state.myParticipantId) {
                    alert('먼저 이름을 입력하고 참여해주세요!');
                    const input = document.getElementById('participant-name-input');
                    if (input) input.focus();
                    return;
                }
                isMouseDown = true;
                isDragging = false;
                dragStartCell = dateStr;

                const selectedBy = state.selections[dateStr] || [];
                const isSelected = selectedBy.includes(state.myParticipantId);
                dragAction = isSelected ? 'deselect' : 'select';

                applyDragAction(dateStr);
                // 스크롤 방지 (날짜 드래그 선택 의도로 처리)
                e.preventDefault();
            }, { passive: false });
        }

        grid.appendChild(cell);
    }
}

// 캘린더의 모든 셀 UI를 부드럽게 일괄 업데이트 (DOM 재구성 없음)
function updateAllCellsUI() {
    document.querySelectorAll('.calendar-cell[data-date]').forEach(cell => {
        updateCellUI(cell.dataset.date);
    });
}

// 개별 셀 UI만 부드럽고 가볍게 갱신하는 헬퍼 함수 (DOM 재생성 방지)
function updateCellUI(dateStr) {
    const cell = document.querySelector(`.calendar-cell[data-date="${dateStr}"]`);
    if (!cell) return;

    let barsContainer = cell.querySelector('.bars-container');
    if (!barsContainer) {
        barsContainer = document.createElement('div');
        barsContainer.className = 'bars-container';
        cell.appendChild(barsContainer);
    }

    barsContainer.innerHTML = '';
    cell.classList.remove('selected-by-me');

    const selectedBy = state.selections[dateStr] || [];
    selectedBy.forEach(pId => {
        const p = state.participants.find(x => x.id === pId);
        if (p) {
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.backgroundColor = p.color;
            if (pId === state.myParticipantId) {
                bar.classList.add('my-selection');
                cell.classList.add('selected-by-me');
            }
            barsContainer.appendChild(bar);
        }
    });
}

// 드래그/클릭 액션 처리 함수
function applyDragAction(dateStr) {
    if (!state.myParticipantId) return;

    if (!state.selections[dateStr]) {
        state.selections[dateStr] = [];
    }

    const index = state.selections[dateStr].indexOf(state.myParticipantId);
    let changed = false;

    if (dragAction === 'select') {
        if (index === -1) {
            state.selections[dateStr].push(state.myParticipantId);
            changed = true;
        }
    } else if (dragAction === 'deselect') {
        if (index > -1) {
            state.selections[dateStr].splice(index, 1);
            if (state.selections[dateStr].length === 0) {
                delete state.selections[dateStr];
            }
            changed = true;
        }
    }

    if (changed) {
        updateCellUI(dateStr);
        syncManager.broadcast();
        renderRecommendations();
    }
}

function renderParticipants() {
    const list = document.getElementById('participants-list');
    list.innerHTML = '';

    document.getElementById('participant-count').textContent = state.participants.length;

    state.participants.forEach(p => {
        const li = document.createElement('li');
        li.className = 'participant-item';

        const info = document.createElement('div');
        info.className = 'participant-info';

        const dot = document.createElement('div');
        dot.className = 'color-dot';
        dot.style.backgroundColor = p.color;

        const nameNode = document.createTextNode(p.id === state.myParticipantId ? p.name + ' (나)' : p.name);

        info.appendChild(dot);
        info.appendChild(nameNode);

        // 방장(hostId) 표시를 이름 옆에 왕관으로 추가
        if (state.hostId === p.id) {
            const crown = document.createElement('span');
            crown.style.marginLeft = '4px';
            crown.textContent = '👑';
            crown.title = '방장';
            info.appendChild(crown);
        }

        li.appendChild(info);

        // 방장은 자신(myParticipantId)은 삭제할 수 없음
        if (state.isHost && p.id !== state.myParticipantId) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = '참가자 삭제';
            removeBtn.onclick = () => removeParticipant(p.id);
            li.appendChild(removeBtn);
        }

        list.appendChild(li);
    });
}

function removeParticipant(id) {
    if (id === state.myParticipantId) {
        alert('방장 자신은 삭제할 수 없습니다!');
        return;
    }
    if (!confirm('해당 참가자와 선택한 일정을 모두 삭제하시겠습니까?')) return;

    state.participants = state.participants.filter(p => p.id !== id);

    for (const date in state.selections) {
        state.selections[date] = state.selections[date].filter(pId => pId !== id);
        if (state.selections[date].length === 0) delete state.selections[date];
    }

    // If I deleted myself
    if (id === state.myParticipantId) {
        state.myParticipantId = null;
        localStorage.removeItem('my_id_' + state.roomId);
        document.getElementById('join-form').classList.remove('hidden');
        document.getElementById('my-status').classList.add('hidden');
    }

    syncManager.broadcast();
    renderParticipants();
    renderCalendar();
    renderRecommendations();
}

function renderRecommendations() {
    const list = document.getElementById('recommendations-list');
    list.innerHTML = '';

    if (state.participants.length === 0) {
        list.innerHTML = '<li style="color:var(--text-secondary); text-align:center; padding: 1rem;">참가자가 없습니다.</li>';
        return;
    }

    const counts = [];
    for (const date in state.selections) {
        const count = state.selections[date].length;
        if (count > 1) { // 1명만 선택한 날짜는 제외 (2명 이상만 추천)
            counts.push({ date, count });
        }
    }

    counts.sort((a, b) => b.count - a.count);

    const topCounts = counts.slice(0, 5);

    if (topCounts.length === 0) {
        list.innerHTML = '<li style="color:var(--text-secondary); text-align:center; padding: 1rem;">2명 이상 가능한 날짜가 없습니다.</li>';
        return;
    }

    topCounts.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'recommendation-item';
        if (index === 0 && item.count === state.participants.length && item.count > 1) {
            li.classList.add('rank-1');
        }

        const dateObj = new Date(item.date);
        const dateStr = `${dateObj.getMonth() + 1}월 ${dateObj.getDate()}일`;

        const dateEl = document.createElement('span');
        dateEl.className = 'recommendation-date';
        dateEl.textContent = dateStr;

        const countEl = document.createElement('span');
        countEl.className = 'recommendation-count';
        countEl.textContent = `${item.count}명 가능`;

        li.appendChild(dateEl);
        li.appendChild(countEl);
        list.appendChild(li);
    });
}

function setupTheme() {
    const savedTheme = localStorage.getItem('theme') || 'system';
    applyTheme(savedTheme);

    const btns = document.querySelectorAll('.theme-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const theme = e.target.dataset.theme;
            applyTheme(theme);
        });
    });

    // Listen to OS changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (localStorage.getItem('theme') === 'system') {
            document.body.className = e.matches ? 'theme-dark' : 'theme-light';
        }
    });
}

function applyTheme(theme) {
    localStorage.setItem('theme', theme);
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.theme-btn[data-theme="${theme}"]`).classList.add('active');

    if (theme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.className = isDark ? 'theme-dark' : 'theme-light';
    } else {
        document.body.className = `theme-${theme}`;
    }
}
