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
};

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

// Global error handler to help debug UI issues
window.onerror = function(msg, url, line) {
    showError("코드 실행 중 오류: " + msg + " (줄: " + line + ")");
};

// Initialize Supabase Client
let supabase = null;
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
    init: function(roomId) {
        if (CONFIG.LOCAL_MODE_ONLY || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
            console.log("Running in Local Mode (BroadcastChannel + LocalStorage)");
            // Use BroadcastChannel for local cross-tab sync
            try {
                this.channel = new BroadcastChannel('room_' + roomId);
                this.channel.onmessage = (event) => {
                    const data = event.data;
                    if (data.type === 'sync') {
                        Object.assign(state, data.state);
                        renderParticipants();
                        renderCalendar();
                        renderRecommendations();
                    }
                };
            } catch (e) {
                console.warn("BroadcastChannel not supported.");
            }
            
            // Listen to localStorage as fallback
            window.addEventListener('storage', (e) => {
                if (e.key === 'room_' + roomId) {
                    const data = JSON.parse(e.newValue);
                    if (data) {
                        state.participants = data.participants || [];
                        state.selections = data.selections || {};
                        state.roomName = data.roomName || state.roomName;
                        renderParticipants();
                        renderCalendar();
                        renderRecommendations();
                    }
                }
            });

            // Load initial state
            const stored = localStorage.getItem('room_' + roomId);
            if (stored) {
                const data = JSON.parse(stored);
                state.participants = data.participants || [];
                state.selections = data.selections || {};
                state.roomName = data.roomName || '약속날짜 조율';
            }
        } else {
            console.log("Supabase Mode: Initializing...");
            
            // 1. Fetch current state from DB
            this.fetchFromSupabase(roomId);

            // 2. Subscribe to realtime changes
            supabase
                .channel('room_updates_' + roomId)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, payload => {
                    const newState = payload.new.state;
                    if (newState) {
                        state.participants = newState.participants || [];
                        state.selections = newState.selections || {};
                        state.roomName = newState.roomName || state.roomName;
                        renderParticipants();
                        renderCalendar();
                        renderRecommendations();
                    }
                })
                .subscribe();
        }
    },
    fetchFromSupabase: async function(roomId) {
        if (!supabase) return;
        const { data, error } = await supabase.from('rooms').select('state').eq('id', roomId).single();
        if (data && data.state) {
            state.participants = data.state.participants || [];
            state.selections = data.state.selections || {};
            state.roomName = data.state.roomName || state.roomName;
            
            // Update UI with fetched state
            document.getElementById('display-room-name').textContent = state.roomName;
            renderParticipants();
            renderCalendar();
            renderRecommendations();
        }
    },
    broadcast: async function() {
        if (CONFIG.LOCAL_MODE_ONLY || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
            const dataToSync = {
                participants: state.participants,
                selections: state.selections,
                roomName: state.roomName
            };
            if (this.channel) this.channel.postMessage({ type: 'sync', state: dataToSync });
            localStorage.setItem('room_' + state.roomId, JSON.stringify(dataToSync));
        } else {
            // Upsert state to Supabase
            if (supabase) {
                await supabase.from('rooms').upsert({ id: state.roomId, state: dataToSync });
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
            if(me) {
                document.getElementById('my-display-name').textContent = me.name;
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

    // Room: Join
    document.getElementById('join-room-btn').addEventListener('click', () => {
        const name = document.getElementById('participant-name-input').value.trim();
        if (!name) return;

        const newId = generateUUID();
        const color = getColor(newId);
        
        state.participants.push({ id: newId, name, color });
        state.myParticipantId = newId;
        
        localStorage.setItem('my_id_' + state.roomId, newId);
        
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
    today.setHours(0,0,0,0);
    
    // Empty cells before start
    for (let i = 0; i < firstDay; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell empty';
        grid.appendChild(cell);
    }
    
    // Days
    for (let i = 1; i <= daysInMonth; i++) {
        const cell = document.createElement('div');
        const dateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const cellDate = new Date(year, month, i);
        
        cell.className = 'calendar-cell';
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
        
        // Click to toggle
        if (cellDate >= today) {
            cell.addEventListener('click', () => toggleSelection(dateStr));
        }
        
        grid.appendChild(cell);
    }
}

function toggleSelection(dateStr) {
    if (!state.myParticipantId) {
        alert('먼저 이름을 입력하고 참여해주세요!');
        document.getElementById('participant-name-input').focus();
        return;
    }
    
    if (!state.selections[dateStr]) {
        state.selections[dateStr] = [];
    }
    
    const index = state.selections[dateStr].indexOf(state.myParticipantId);
    if (index > -1) {
        state.selections[dateStr].splice(index, 1);
        if(state.selections[dateStr].length === 0) delete state.selections[dateStr];
    } else {
        state.selections[dateStr].push(state.myParticipantId);
    }
    
    syncManager.broadcast();
    renderCalendar();
    renderRecommendations();
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
        li.appendChild(info);
        
        if (state.isHost) {
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
    if(!confirm('해당 참가자와 선택한 일정을 모두 삭제하시겠습니까?')) return;
    
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
        counts.push({ date, count: state.selections[date].length });
    }
    
    counts.sort((a, b) => b.count - a.count);
    
    const topCounts = counts.slice(0, 5);
    
    if (topCounts.length === 0) {
        list.innerHTML = '<li style="color:var(--text-secondary); text-align:center; padding: 1rem;">선택된 날짜가 없습니다.</li>';
        return;
    }
    
    topCounts.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'recommendation-item';
        if (index === 0 && item.count === state.participants.length && item.count > 1) {
            li.classList.add('rank-1');
        }
        
        const dateObj = new Date(item.date);
        const dateStr = `${dateObj.getMonth()+1}월 ${dateObj.getDate()}일`;
        
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
