/* =====================================================
   HIT STORE — Main JavaScript Application
   ===================================================== */

const API = '';  // Same origin (empty = relative)
let token = localStorage.getItem('hs_token');
let currentUser = null;
let energyInterval = null;
let toastTimeout = null;

// =====================================================
//  UTILITIES
// =====================================================

function $(id) { return document.getElementById(id); }

function showToast(msg, duration = 3000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.add('hidden'), duration);
}

function formatCoins(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function timeAgo(unixSeconds) {
    const diff = Math.floor(Date.now() / 1000) - unixSeconds;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

async function apiFetch(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    return res.json();
}

// =====================================================
//  AUTH
// =====================================================

function showApp() {
    $('auth-overlay').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('nav-username').textContent = currentUser.username;
    loadProfile();
    startEnergyRegen();
}

function showAuth() {
    $('auth-overlay').classList.remove('hidden');
    $('app').classList.add('hidden');
}

$('go-register').addEventListener('click', () => {
    $('login-form').classList.remove('active');
    $('register-form').classList.add('active');
    $('login-error').classList.add('hidden');
});

$('go-login').addEventListener('click', () => {
    $('register-form').classList.remove('active');
    $('login-form').classList.add('active');
    $('reg-error').classList.add('hidden');
});

$('login-btn').addEventListener('click', async () => {
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    if (!email || !password) { showError('login-error', 'Please fill all fields'); return; }

    $('login-btn').textContent = 'Logging in…';
    $('login-btn').disabled = true;

    const data = await apiFetch('/api/login', 'POST', { email, password });
    $('login-btn').textContent = 'Login & Play';
    $('login-btn').disabled = false;

    if (data.error) { showError('login-error', data.error); return; }
    token = data.token;
    localStorage.setItem('hs_token', token);
    currentUser = { id: data.userId, username: data.username };
    showApp();
});

$('register-btn').addEventListener('click', async () => {
    const username = $('reg-username').value.trim();
    const email = $('reg-email').value.trim();
    const password = $('reg-password').value;
    if (!username || !email || !password) { showError('reg-error', 'Please fill all fields'); return; }

    $('register-btn').textContent = 'Creating…';
    $('register-btn').disabled = true;

    const data = await apiFetch('/api/register', 'POST', { username, email, password });
    $('register-btn').textContent = 'Create & Play';
    $('register-btn').disabled = false;

    if (data.error) { showError('reg-error', data.error); return; }
    token = data.token;
    localStorage.setItem('hs_token', token);
    currentUser = { id: data.userId, username: data.username };
    showApp();
});

$('logout-btn').addEventListener('click', () => {
    token = null;
    currentUser = null;
    localStorage.removeItem('hs_token');
    if (energyInterval) clearInterval(energyInterval);
    showAuth();
});

function showError(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.classList.remove('hidden');
}

// Allow login on Enter key
['login-email', 'login-password'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });
});
['reg-username', 'reg-email', 'reg-password'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') $('register-btn').click(); });
});

// Auto-login if token exists
(async function checkAutoLogin() {
    if (token) {
        const data = await apiFetch('/api/user/profile');
        if (data.error) { localStorage.removeItem('hs_token'); token = null; showAuth(); return; }
        currentUser = { id: data.id, username: data.username };
        showApp();
    }
})();

// =====================================================
//  NAVIGATION TABS
// =====================================================

document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        $(`tab-content-${tabId}`).classList.add('active');

        // Load data for the active tab
        if (tabId === 'upgrades') loadUpgrades();
        if (tabId === 'store') loadStore();
        if (tabId === 'leaderboard') loadLeaderboard();
        if (tabId === 'history') loadHistory();
    });
});

// =====================================================
//  PROFILE & STATS
// =====================================================

let profileData = null;

async function loadProfile() {
    const data = await apiFetch('/api/user/profile');
    if (data.error) return;
    profileData = data;
    updateStatsUI(data);
}

function updateStatsUI(data) {
    $('stat-coins').textContent = formatCoins(data.coins);
    $('stat-level').textContent = data.level;
    $('stat-hits').textContent = formatCoins(data.total_hits);
    $('stat-energy').textContent = data.energy;
    $('stat-max-energy').textContent = data.max_energy;
    $('total-hits-display').textContent = formatCoins(data.total_hits);
    $('hammer-level-display').textContent = data.hammer_level;

    // Coins per hit estimate
    const ownedUpgrades = data.ownedUpgrades || [];
    const damageUpgrades = [2, 3, 5, 10]; // Upgrade values
    const upgradeIds = [1, 2, 3, 4];
    let damageMulti = 1;
    upgradeIds.forEach((id, i) => {
        if (ownedUpgrades.includes(id)) damageMulti = Math.max(damageMulti, damageUpgrades[i]);
    });
    $('coins-per-hit').textContent = data.hammer_level * damageMulti;

    // XP bar
    const xpPct = Math.min((data.xp / data.xpNeeded) * 100, 100);
    $('xp-bar').style.width = xpPct + '%';
    $('xp-text').textContent = `XP: ${formatCoins(data.xp)} / ${formatCoins(data.xpNeeded)}`;

    // Energy bar
    const energyPct = (data.energy / data.max_energy) * 100;
    $('energy-bar').style.width = energyPct + '%';
    $('energy-val').textContent = `${data.energy} / ${data.max_energy}`;

    // Milestones
    renderMilestones(data.total_hits, data.coins);

    // Restore stone crack state on load
    updateStoneCracks(data.total_hits);
}

function renderMilestones(hits, coins) {
    const milestones = [
        { icon: '🥉', text: 'First 10 Hits', achieved: hits >= 10, reward: '+10 XP' },
        { icon: '🥈', text: '100 Hits Club', achieved: hits >= 100, reward: '+50 XP' },
        { icon: '🥇', text: '1,000 Hit Legend', achieved: hits >= 1000, reward: '+200 XP' },
        { icon: '💰', text: 'Earn 1K Coins', achieved: coins >= 1000, reward: 'Rich!' },
        { icon: '💎', text: 'Earn 100K Coins', achieved: coins >= 100000, reward: 'Legend' },
    ];

    $('milestones-list').innerHTML = milestones.map(m => `
    <div class="milestone-item ${m.achieved ? 'achieved' : ''}">
      <span class="ms-icon">${m.icon}</span>
      <span class="ms-text">${m.text}</span>
      ${m.achieved ? `<span class="milestone-badge">✓ ${m.reward}</span>` : ''}
    </div>
  `).join('');
}

// =====================================================
//  ENERGY REGENERATION (CLIENT-SIDE DISPLAY)
// =====================================================

function startEnergyRegen() {
    if (energyInterval) clearInterval(energyInterval);
    energyInterval = setInterval(() => {
        if (!profileData) return;
        if (profileData.energy < profileData.max_energy) {
            profileData.energy = Math.min(profileData.energy + 1, profileData.max_energy);
            $('stat-energy').textContent = profileData.energy;
            $('energy-val').textContent = `${profileData.energy} / ${profileData.max_energy}`;
            const pct = (profileData.energy / profileData.max_energy) * 100;
            $('energy-bar').style.width = pct + '%';
        }
    }, 1000);
}

// =====================================================
//  HIT THE STORE (GAME)
// =====================================================

let isHitting = false;

async function hitStore() {
    if (isHitting) return;
    if (!profileData) return;

    if (profileData.energy < 1) {
        showToast('⚡ Not enough energy! Wait for regen or buy a refill.', 3000);
        return;
    }

    isHitting = true;

    // Stone shake animation
    const stoneWrap = $('store-building');
    stoneWrap.classList.add('hit-anim');
    stoneWrap.addEventListener('animationend', () => stoneWrap.classList.remove('hit-anim'), { once: true });

    // Spawn floating coins
    spawnFloatingCoin();

    const data = await apiFetch('/api/game/hit', 'POST');
    isHitting = false;

    if (data.error) { showToast('❌ ' + data.error, 2500); return; }

    // Update local state
    profileData.coins = data.newCoins;
    profileData.energy = data.newEnergy;
    profileData.xp = data.newXp;
    profileData.level = data.newLevel;
    profileData.total_hits = data.totalHits;
    profileData.xpNeeded = data.xpNeeded;

    // Show hit feedback text
    showHitFeedback(`+${data.coinsEarned}🪙${data.luckyExtra > 0 ? ' 🍀' : ''}`);

    // Update UI stats
    $('stat-coins').textContent = formatCoins(data.newCoins);
    $('stat-energy').textContent = data.newEnergy;
    $('stat-hits').textContent = formatCoins(data.totalHits);
    $('stat-level').textContent = data.newLevel;
    $('total-hits-display').textContent = formatCoins(data.totalHits);

    const xpPct = Math.min((data.newXp / data.xpNeeded) * 100, 100);
    $('xp-bar').style.width = xpPct + '%';
    $('xp-text').textContent = `XP: ${formatCoins(data.newXp)} / ${formatCoins(data.xpNeeded)}`;

    const energyPct = (data.newEnergy / profileData.max_energy) * 100;
    $('energy-bar').style.width = energyPct + '%';
    $('energy-val').textContent = `${data.newEnergy} / ${profileData.max_energy}`;

    renderMilestones(data.totalHits, data.newCoins);

    // 🪨 Update stone crack visuals
    updateStoneCracks(data.totalHits);

    // Level up?
    if (data.leveledUp) {
        $('levelup-text').textContent = `You reached Level ${data.newLevel}! 🎉`;
        $('levelup-modal').classList.remove('hidden');
    }
}


$('hit-btn').addEventListener('click', hitStore);
$('store-building').addEventListener('click', hitStore);

document.addEventListener('keydown', e => {
    if (e.code === 'Space' && $('tab-content-game').classList.contains('active')) {
        e.preventDefault();
        hitStore();
    }
});

$('levelup-close').addEventListener('click', () => $('levelup-modal').classList.add('hidden'));
$('lucky-close').addEventListener('click', () => $('lucky-modal').classList.add('hidden'));

// Floating coin animation
function spawnFloatingCoin() {
    const coin = document.createElement('div');
    coin.textContent = '🪙';
    coin.style.cssText = `
    position: fixed;
    font-size: ${18 + Math.random() * 16}px;
    left: ${Math.random() * 100}vw;
    top: 60vh;
    pointer-events: none;
    z-index: 8000;
    animation: coinFloat 1.4s ease forwards;
    opacity: 0.9;
  `;
    document.body.appendChild(coin);
    setTimeout(() => coin.remove(), 1500);
}

// Inject coin float keyframe
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes coinFloat {
    0%   { transform: translateY(0) scale(1) rotate(0deg); opacity: 0.9; }
    100% { transform: translateY(-220px) scale(0.5) rotate(${Math.random() > 0.5 ? 180 : -180}deg); opacity: 0; }
  }
`;
document.head.appendChild(styleEl);

function showHitFeedback(text) {
    const fb = $('hit-feedback');
    $('hit-coins-text').textContent = text;
    fb.classList.remove('hidden');
    fb.style.animation = 'none';
    fb.offsetHeight; // reflow
    fb.style.animation = '';
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 1300);
}

// =====================================================
//  STONE CRACK SYSTEM
// =====================================================

// Crack thresholds for each SVG layer
const CRACK_THRESHOLDS = [
    { id: 'crack-1', at: 20 },
    { id: 'crack-2', at: 50 },
    { id: 'crack-3', at: 100 },
    { id: 'crack-4', at: 500 },
];

// Max hits considered for the durability bar (resets after shattering)
const DURABILITY_CYCLE = 500;

function updateStoneCracks(totalHits) {
    // Show crack SVG layers progressively
    CRACK_THRESHOLDS.forEach(c => {
        const el = document.getElementById(c.id);
        if (!el) return;
        if (totalHits >= c.at) {
            el.classList.add('visible');
            el.style.display = '';
        }
    });

    // Darken stone body as cracks accumulate
    const stoneBody = document.getElementById('stone-body');
    if (stoneBody) {
        stoneBody.classList.remove('cracked-1', 'cracked-2', 'cracked-3', 'cracked-4');
        if (totalHits >= 500) stoneBody.classList.add('cracked-4');
        else if (totalHits >= 100) stoneBody.classList.add('cracked-3');
        else if (totalHits >= 50) stoneBody.classList.add('cracked-2');
        else if (totalHits >= 20) stoneBody.classList.add('cracked-1');
    }

    // Update crack health bar
    const hitsInCycle = totalHits % DURABILITY_CYCLE || (totalHits >= DURABILITY_CYCLE ? DURABILITY_CYCLE : totalHits);
    const durabilityPct = Math.max(0, 100 - (hitsInCycle / DURABILITY_CYCLE) * 100);
    const bar = document.getElementById('crack-bar');
    const pctText = document.getElementById('crack-pct-text');
    if (bar) {
        bar.style.width = durabilityPct + '%';
        bar.classList.remove('dmg-25', 'dmg-50', 'dmg-75', 'dmg-critical');
        if (durabilityPct <= 10) bar.classList.add('dmg-critical');
        else if (durabilityPct <= 25) bar.classList.add('dmg-75');
        else if (durabilityPct <= 50) bar.classList.add('dmg-50');
        else if (durabilityPct <= 75) bar.classList.add('dmg-25');
    }
    if (pctText) pctText.textContent = Math.round(durabilityPct) + '%';

    // Spawn dust particles inside the SVG on each hit
    spawnStoneDust();
}

function spawnStoneDust() {
    const dustGroup = document.getElementById('stone-dust');
    if (!dustGroup) return;
    for (let i = 0; i < 5; i++) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        const x = 80 + Math.random() * 140;
        const y = 60 + Math.random() * 140;
        const r = 1.5 + Math.random() * 3;
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', r);
        circle.setAttribute('fill', `rgba(180,160,140,${0.5 + Math.random() * 0.4})`);
        circle.style.animation = `dustFade 0.7s ease forwards`;
        dustGroup.appendChild(circle);
        setTimeout(() => circle.remove(), 750);
    }
}

// Inject dust fade keyframe
const dustStyle = document.createElement('style');
dustStyle.textContent = `
  @keyframes dustFade {
    0%   { opacity: 1; transform: translate(0, 0) scale(1); }
    100% { opacity: 0; transform: translate(${Math.random() > 0.5 ? '' : '-'}${5 + Math.random() * 15}px, -${10 + Math.random() * 20}px) scale(0.3); }
  }
`;
document.head.appendChild(dustStyle);


// =====================================================
//  UPGRADES
// =====================================================

async function loadUpgrades() {
    const upgrades = await apiFetch('/api/upgrades');
    if (!Array.isArray(upgrades)) return;
    const userData = await apiFetch('/api/user/profile');

    $('upgrades-grid').innerHTML = upgrades.map(u => `
    <div class="upgrade-card ${u.owned ? 'owned' : ''}" id="upg-card-${u.id}">
      <div class="card-icon">${u.icon}</div>
      <div class="card-name">${u.name}</div>
      <div class="card-desc">${u.description}</div>
      <div class="card-footer">
        <div class="card-price"><span class="price-icon">🪙</span> ${formatCoins(u.cost)}</div>
        ${u.owned
            ? `<div class="owned-badge">✓ Owned</div>`
            : `<button class="btn btn-primary btn-sm" id="buy-upg-${u.id}"
               onclick="buyUpgrade(${u.id}, ${u.cost})"
               ${userData.coins < u.cost ? 'disabled title="Not enough coins"' : ''}>
               Buy
             </button>`
        }
      </div>
    </div>
  `).join('');
}

window.buyUpgrade = async function (id, cost) {
    const btn = $(`buy-upg-${id}`);
    if (btn) { btn.textContent = 'Buying…'; btn.disabled = true; }

    const data = await apiFetch(`/api/upgrades/buy/${id}`, 'POST');
    if (data.error) {
        showToast('❌ ' + data.error, 2500);
        if (btn) { btn.textContent = 'Buy'; btn.disabled = false; }
        return;
    }
    showToast('✅ Upgrade purchased!', 2500);
    if (profileData) {
        profileData.coins = data.newCoins;
        $('stat-coins').textContent = formatCoins(data.newCoins);
    }
    loadUpgrades();
    loadProfile();
};

// =====================================================
//  STORE
// =====================================================

async function loadStore() {
    const items = await apiFetch('/api/store');
    if (!Array.isArray(items)) return;
    const userData = await apiFetch('/api/user/profile');

    $('store-grid').innerHTML = items.map(item => `
    <div class="store-card">
      <div class="card-icon">${item.icon}</div>
      <div class="card-name">${item.name}</div>
      <div class="card-desc">${item.description}</div>
      <div class="card-footer">
        <div class="card-price"><span class="price-icon">🪙</span> ${formatCoins(item.price)}</div>
        <button class="btn btn-primary btn-sm" id="buy-store-${item.id}"
          onclick="buyStoreItem(${item.id})"
          ${userData.coins < item.price ? 'disabled title="Not enough coins"' : ''}>
          Buy
        </button>
      </div>
    </div>
  `).join('');
}

window.buyStoreItem = async function (id) {
    const btn = $(`buy-store-${id}`);
    if (btn) { btn.textContent = 'Buying…'; btn.disabled = true; }

    const data = await apiFetch(`/api/store/buy/${id}`, 'POST');
    if (data.error) {
        showToast('❌ ' + data.error, 2500);
        if (btn) { btn.textContent = 'Buy'; btn.disabled = false; }
        return;
    }

    showToast('✅ ' + data.message, 3000);

    if (profileData) {
        profileData.coins = data.newCoins;
        $('stat-coins').textContent = formatCoins(data.newCoins);
    }

    // Lucky box reveal
    if (data.luckyWin) {
        $('lucky-text').textContent = `You won ${formatCoins(data.luckyWin)} coins! 🎉`;
        $('lucky-modal').classList.remove('hidden');
    }

    loadProfile();
    loadStore();
};

// =====================================================
//  LEADERBOARD
// =====================================================

async function loadLeaderboard() {
    const data = await apiFetch('/api/leaderboard');
    if (!Array.isArray(data)) return;

    // Podium (top 3)
    const podiumEmojis = ['🥇', '🥈', '🥉'];
    const podiumClasses = ['first', 'second', 'third'];
    const podiumOrder = [1, 0, 2]; // show 2nd, 1st, 3rd visually
    const top3 = data.slice(0, 3);

    $('leaderboard-podium').innerHTML = podiumOrder.map(idx => {
        const entry = top3[idx];
        if (!entry) return '<div class="podium-slot"></div>';
        return `
      <div class="podium-slot">
        <div class="podium-rank">${podiumEmojis[idx]}</div>
        <div class="podium-name">${entry.username}</div>
        <div class="podium-coins">🪙 ${formatCoins(entry.coins)}</div>
        <div class="podium-block ${podiumClasses[idx]}">${idx === 0 ? '🏆' : idx === 1 ? '🥈' : '🥉'}</div>
      </div>
    `;
    }).join('');

    // Table list (all)
    $('leaderboard-list').innerHTML = `
    <div class="lb-row lb-header">
      <div>#</div><div>Player</div><div>Coins</div><div>Hits</div>
    </div>
    ${data.map((entry, i) => `
      <div class="lb-row ${currentUser && entry.username === currentUser.username ? 'me' : ''}">
        <div class="lb-rank">${i < 3 ? podiumEmojis[i] : '#' + (i + 1)}</div>
        <div class="lb-name">${entry.username} ${entry.username === currentUser?.username ? '(You)' : ''}</div>
        <div class="lb-coins">🪙 ${formatCoins(entry.coins)}</div>
        <div class="lb-hits">⚒️ ${formatCoins(entry.total_hits)}</div>
      </div>
    `).join('')}
  `;
}

// =====================================================
//  TRANSACTION HISTORY
// =====================================================

async function loadHistory() {
    const data = await apiFetch('/api/transactions');
    if (!Array.isArray(data)) return;

    if (data.length === 0) {
        $('history-list').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">No transactions yet. Go hit the store! ⚒️</p>';
        return;
    }

    const icons = { earn: '✅', spend: '💸' };

    $('history-list').innerHTML = data.map(tx => `
    <div class="history-item">
      <span class="history-icon">${icons[tx.type] || '💱'}</span>
      <span class="history-desc">${tx.description}</span>
      <span class="history-amount ${tx.type}">${tx.type === 'earn' ? '+' : '-'}${formatCoins(tx.amount)} 🪙</span>
      <span class="history-time">${timeAgo(tx.created_at)}</span>
    </div>
  `).join('');
}
