const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'hit_store_secret_key_2024';
const ADMIN_SECRET = 'admin_secret_2024'; // Admin login key

// ─── Database ──────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'game.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    coins INTEGER DEFAULT 0,
    total_hits INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    hammer_level INTEGER DEFAULT 1,
    energy INTEGER DEFAULT 100,
    max_energy INTEGER DEFAULT 100,
    last_energy_time INTEGER DEFAULT (strftime('%s','now')),
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT NOT NULL,
    cost INTEGER NOT NULL, type TEXT NOT NULL,
    value INTEGER NOT NULL, icon TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, upgrade_id INTEGER NOT NULL,
    purchased_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (upgrade_id) REFERENCES upgrades(id)
  );
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    coins INTEGER NOT NULL, total_hits INTEGER NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, type TEXT NOT NULL,
    amount INTEGER NOT NULL, description TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS store_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT NOT NULL,
    price INTEGER NOT NULL, type TEXT NOT NULL,
    value INTEGER NOT NULL, icon TEXT NOT NULL,
    available INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL,
    account_info TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    link_url TEXT DEFAULT '',
    coin_reward INTEGER DEFAULT 10,
    active INTEGER DEFAULT 1,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS ad_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ad_id INTEGER NOT NULL,
    viewed_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (ad_id) REFERENCES ads(id)
  );
`);

// ─── Seed upgrades ─────────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as c FROM upgrades').get().c === 0) {
    const ins = db.prepare('INSERT INTO upgrades (name,description,cost,type,value,icon) VALUES(?,?,?,?,?,?)');
    ins.run('Iron Hammer', 'Doubles your hit damage', 500, 'damage', 2, '🔨');
    ins.run('Steel Hammer', 'Triples your hit damage', 2000, 'damage', 3, '⚒️');
    ins.run('Golden Hammer', '5x your hit damage', 8000, 'damage', 5, '🪙');
    ins.run('Diamond Hammer', '10x your hit damage', 25000, 'damage', 10, '💎');
    ins.run('Energy Boost I', 'Increase max energy by 50', 300, 'energy', 50, '⚡');
    ins.run('Energy Boost II', 'Increase max energy by 100', 1200, 'energy', 100, '⚡');
    ins.run('Energy Boost III', 'Increase max energy by 200', 5000, 'energy', 200, '🔋');
    ins.run('Lucky Strike', '+50% bonus coins on hits', 3000, 'luck', 50, '🍀');
    ins.run('Mega Strike', '+100% bonus coins on hits', 10000, 'luck', 100, '🌟');
}

// ─── Seed store items ───────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as c FROM store_items').get().c === 0) {
    const ins = db.prepare('INSERT INTO store_items (name,description,price,type,value,icon) VALUES(?,?,?,?,?,?)');
    ins.run('Energy Refill', 'Fully restore your energy', 200, 'energy_refill', 100, '⚡');
    ins.run('Coin Multiplier (1h)', 'Double coins for 1 hour', 1000, 'multiplier', 2, '💰');
    ins.run('Auto Clicker (10min)', 'Auto-hits the store for 10 minutes', 1500, 'auto_click', 10, '🤖');
    ins.run('Lucky Box', 'Win a random amount of coins (100-5000)', 500, 'lucky_box', 5000, '🎁');
    ins.run('XP Boost (1h)', 'Double XP for 1 hour', 800, 'xp_boost', 2, '✨');
}

// ─── Seed default ads ───────────────────────────────────────
if (db.prepare('SELECT COUNT(*) as c FROM ads').get().c === 0) {
    const ins = db.prepare('INSERT INTO ads (title,description,image_url,link_url,coin_reward,active) VALUES(?,?,?,?,?,?)');
    ins.run('⚡ Power Up Your Game!', 'Upgrade your hammer and smash harder. Click to get a free upgrade tip!', '', 'https://example.com/ad1', 15, 1);
    ins.run('🏆 Join the Tournament!', 'Compete with players worldwide. Top prizes every week!', '', 'https://example.com/ad2', 20, 1);
    ins.run('💎 Premium Tools Sale', 'Get Diamond tools at 50% off! Limited time offer.', '', 'https://example.com/ad3', 10, 1);
}

// ─── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ─────────────────────────────────────────
function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        const d = jwt.verify(token, JWT_SECRET);
        req.userId = d.userId;
        req.isAdmin = d.isAdmin || false;
        next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminAuth(req, res, next) {
    auth(req, res, () => {
        if (!req.isAdmin) return res.status(403).json({ error: 'Admin only' });
        next();
    });
}

// ─── Helpers ─────────────────────────────────────────────────
function regenEnergy(user) {
    const now = Math.floor(Date.now() / 1000);
    const regen = Math.floor((now - user.last_energy_time) * 1);
    const newE = Math.min(user.energy + regen, user.max_energy);
    if (regen > 0) {
        db.prepare('UPDATE users SET energy=?,last_energy_time=? WHERE id=?').run(newE, now, user.id);
        user.energy = newE; user.last_energy_time = now;
    }
    return user;
}

function xpForLevel(lvl) { return lvl * lvl * 100; }

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
    try {
        const hash = bcrypt.hashSync(password, 10);
        const r = db.prepare('INSERT INTO users (username,email,password) VALUES(?,?,?)').run(username, email, hash);
        db.prepare('INSERT INTO leaderboard (user_id,coins,total_hits) VALUES(?,0,0)').run(r.lastInsertRowid);
        const token = jwt.sign({ userId: r.lastInsertRowid, isAdmin: false }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: r.lastInsertRowid, username, isAdmin: false });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username or email already exists' });
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password))
        return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, isAdmin: user.is_admin === 1 }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user.id, username: user.username, isAdmin: user.is_admin === 1 });
});

// ══════════════════════════════════════════════════════════════
//  USER ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/user/profile', auth, (req, res) => {
    let user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user = regenEnergy(user);
    const { password, ...safe } = user;
    safe.xpNeeded = xpForLevel(safe.level);
    safe.ownedUpgrades = db.prepare('SELECT upgrade_id FROM user_upgrades WHERE user_id=?').all(req.userId).map(u => u.upgrade_id);
    res.json(safe);
});

// ══════════════════════════════════════════════════════════════
//  GAME ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/game/hit', auth, (req, res) => {
    let user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user = regenEnergy(user);
    if (user.energy < 1) return res.status(400).json({ error: 'Not enough energy!' });

    const upgrades = db.prepare(`
    SELECT u.type, u.value FROM user_upgrades pu
    JOIN upgrades u ON pu.upgrade_id = u.id WHERE pu.user_id=?
  `).all(req.userId);

    let dmg = 1, luck = 0;
    for (const u of upgrades) {
        if (u.type === 'damage') dmg = Math.max(dmg, u.value);
        if (u.type === 'luck') luck += u.value;
    }

    const base = user.hammer_level * dmg;
    const bonus = Math.random() < (luck / 100) ? Math.floor(base * 0.5) : 0;
    const coins = base + bonus;
    const xp = Math.floor(coins * 0.5) + 1;
    let newXp = user.xp + xp;
    let newLvl = user.level;
    let leveled = false;
    while (newXp >= xpForLevel(newLvl)) { newXp -= xpForLevel(newLvl); newLvl++; leveled = true; }

    const now = Math.floor(Date.now() / 1000);
    const newCoins = user.coins + coins;
    const newHits = user.total_hits + 1;
    db.prepare('UPDATE users SET coins=?,total_hits=?,xp=?,level=?,energy=?,last_energy_time=? WHERE id=?')
        .run(newCoins, newHits, newXp, newLvl, user.energy - 1, now, req.userId);
    db.prepare(`INSERT INTO leaderboard (user_id,coins,total_hits,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET coins=excluded.coins,total_hits=excluded.total_hits,updated_at=excluded.updated_at`)
        .run(req.userId, newCoins, newHits, now);
    db.prepare('INSERT INTO transactions (user_id,type,amount,description) VALUES(?,?,?,?)')
        .run(req.userId, 'earn', coins, `Hit the stone! +${coins} coins`);

    res.json({
        coinsEarned: coins, luckyExtra: bonus, xpEarned: xp, newCoins, newEnergy: user.energy - 1,
        newXp, newLevel: newLvl, leveledUp: leveled, xpNeeded: xpForLevel(newLvl), totalHits: newHits
    });
});

// ══════════════════════════════════════════════════════════════
//  UPGRADES
// ══════════════════════════════════════════════════════════════
app.get('/api/upgrades', auth, (req, res) => {
    const all = db.prepare('SELECT * FROM upgrades').all();
    const owned = db.prepare('SELECT upgrade_id FROM user_upgrades WHERE user_id=?').all(req.userId).map(u => u.upgrade_id);
    res.json(all.map(u => ({ ...u, owned: owned.includes(u.id) })));
});

app.post('/api/upgrades/buy/:id', auth, (req, res) => {
    const upg = db.prepare('SELECT * FROM upgrades WHERE id=?').get(+req.params.id);
    if (!upg) return res.status(404).json({ error: 'Not found' });
    if (db.prepare('SELECT id FROM user_upgrades WHERE user_id=? AND upgrade_id=?').get(req.userId, upg.id))
        return res.status(400).json({ error: 'Already owned' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
    if (user.coins < upg.cost) return res.status(400).json({ error: 'Not enough coins' });
    const newCoins = user.coins - upg.cost;
    db.prepare('UPDATE users SET coins=? WHERE id=?').run(newCoins, req.userId);
    db.prepare('INSERT INTO user_upgrades (user_id,upgrade_id) VALUES(?,?)').run(req.userId, upg.id);
    if (upg.type === 'energy')
        db.prepare('UPDATE users SET max_energy=max_energy+? WHERE id=?').run(upg.value, req.userId);
    db.prepare('INSERT INTO transactions (user_id,type,amount,description) VALUES(?,?,?,?)')
        .run(req.userId, 'spend', upg.cost, `Bought upgrade: ${upg.name}`);
    res.json({ success: true, newCoins });
});

// ══════════════════════════════════════════════════════════════
//  STORE
// ══════════════════════════════════════════════════════════════
app.get('/api/store', auth, (req, res) =>
    res.json(db.prepare('SELECT * FROM store_items WHERE available=1').all()));

app.post('/api/store/buy/:id', auth, (req, res) => {
    const item = db.prepare('SELECT * FROM store_items WHERE id=?').get(+req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
    if (user.coins < item.price) return res.status(400).json({ error: 'Not enough coins' });
    const spent = user.coins - item.price;
    let luckyWin = 0, msg = '';
    if (item.type === 'energy_refill') {
        db.prepare('UPDATE users SET coins=?,energy=max_energy WHERE id=?').run(spent, req.userId);
        msg = 'Energy fully restored!';
    } else if (item.type === 'lucky_box') {
        luckyWin = Math.floor(Math.random() * 4901) + 100;
        db.prepare('UPDATE users SET coins=? WHERE id=?').run(spent + luckyWin, req.userId);
        msg = `Lucky Box! You won ${luckyWin} coins!`;
    } else {
        db.prepare('UPDATE users SET coins=? WHERE id=?').run(spent, req.userId);
        msg = `${item.name} activated!`;
    }
    db.prepare('INSERT INTO transactions (user_id,type,amount,description) VALUES(?,?,?,?)')
        .run(req.userId, 'spend', item.price, `Bought: ${item.name}`);
    res.json({ success: true, newCoins: item.type === 'lucky_box' ? spent + luckyWin : spent, message: msg, luckyWin });
});

// ══════════════════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════════════════
app.get('/api/leaderboard', (req, res) => res.json(db.prepare(`
  SELECT u.username, l.coins, l.total_hits, u.level, u.hammer_level
  FROM leaderboard l JOIN users u ON l.user_id=u.id
  ORDER BY l.coins DESC LIMIT 20
`).all()));

// ══════════════════════════════════════════════════════════════
//  TRANSACTIONS
// ══════════════════════════════════════════════════════════════
app.get('/api/transactions', auth, (req, res) =>
    res.json(db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.userId)));

// ══════════════════════════════════════════════════════════════
//  ADS — USER
// ══════════════════════════════════════════════════════════════
app.get('/api/ads', auth, (req, res) => {
    const ads = db.prepare('SELECT * FROM ads WHERE active=1 ORDER BY id').all();
    // mark which ones user watched today
    const todayStart = Math.floor(Date.now() / 1000) - 86400;
    const watchedToday = db.prepare('SELECT ad_id FROM ad_views WHERE user_id=? AND viewed_at>?')
        .all(req.userId, todayStart).map(v => v.ad_id);
    res.json(ads.map(a => ({ ...a, watchedToday: watchedToday.includes(a.id) })));
});

app.post('/api/ads/watch/:id', auth, (req, res) => {
    const ad = db.prepare('SELECT * FROM ads WHERE id=? AND active=1').get(+req.params.id);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    const todayStart = Math.floor(Date.now() / 1000) - 86400;
    const alreadyWatched = db.prepare('SELECT id FROM ad_views WHERE user_id=? AND ad_id=? AND viewed_at>?')
        .get(req.userId, ad.id, todayStart);
    if (alreadyWatched) return res.status(400).json({ error: 'Already watched today' });

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
    const newCoins = user.coins + ad.coin_reward;
    db.prepare('UPDATE users SET coins=? WHERE id=?').run(newCoins, req.userId);
    db.prepare('UPDATE ads SET views=views+1 WHERE id=?').run(ad.id);
    db.prepare('INSERT INTO ad_views (user_id,ad_id) VALUES(?,?)').run(req.userId, ad.id);
    db.prepare('INSERT INTO transactions (user_id,type,amount,description) VALUES(?,?,?,?)')
        .run(req.userId, 'earn', ad.coin_reward, `Watched ad: ${ad.title}`);
    res.json({ success: true, newCoins, reward: ad.coin_reward });
});

app.post('/api/ads/click/:id', auth, (req, res) => {
    db.prepare('UPDATE ads SET clicks=clicks+1 WHERE id=?').run(+req.params.id);
    const ad = db.prepare('SELECT link_url FROM ads WHERE id=?').get(+req.params.id);
    res.json({ success: true, link: ad?.link_url || '' });
});

// ══════════════════════════════════════════════════════════════
//  WITHDRAWALS — USER
// ══════════════════════════════════════════════════════════════
app.post('/api/withdraw/request', auth, (req, res) => {
    const { amount, method, accountInfo } = req.body;
    if (!amount || !method || !accountInfo) return res.status(400).json({ error: 'All fields required' });
    if (amount < 1000) return res.status(400).json({ error: 'Minimum withdrawal is 1,000 coins' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
    if (user.coins < amount) return res.status(400).json({ error: 'Not enough coins' });
    // Deduct coins immediately & put on hold
    db.prepare('UPDATE users SET coins=? WHERE id=?').run(user.coins - amount, req.userId);
    db.prepare('INSERT INTO withdrawals (user_id,username,amount,method,account_info) VALUES(?,?,?,?,?)')
        .run(req.userId, user.username, amount, method, accountInfo);
    db.prepare('INSERT INTO transactions (user_id,type,amount,description) VALUES(?,?,?,?)')
        .run(req.userId, 'spend', amount, `Withdrawal request – ${method}`);
    res.json({ success: true, newCoins: user.coins - amount });
});

app.get('/api/withdraw/my', auth, (req, res) =>
    res.json(db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC').all(req.userId)));

// ══════════════════════════════════════════════════════════════
//  ADMIN — Login
// ══════════════════════════════════════════════════════════════
app.post('/api/admin/login', (req, res) => {
    const { email, password, adminKey } = req.body;
    if (adminKey !== ADMIN_SECRET) return res.status(403).json({ error: 'Invalid admin key' });
    const user = db.prepare('SELECT * FROM users WHERE email=? AND is_admin=1').get(email);
    if (!user || !bcrypt.compareSync(password, user.password))
        return res.status(401).json({ error: 'Invalid admin credentials' });
    const token = jwt.sign({ userId: user.id, isAdmin: true }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, username: user.username });
});

// Create admin account endpoint (one-time, use admin key)
app.post('/api/admin/create', (req, res) => {
    const { username, email, password, adminKey } = req.body;
    if (adminKey !== ADMIN_SECRET) return res.status(403).json({ error: 'Invalid admin key' });
    try {
        const hash = bcrypt.hashSync(password, 10);
        const r = db.prepare('INSERT INTO users (username,email,password,is_admin) VALUES(?,?,?,1)').run(username, email, hash);
        db.prepare('INSERT INTO leaderboard (user_id,coins,total_hits) VALUES(?,0,0)').run(r.lastInsertRowid);
        res.json({ success: true, message: 'Admin account created' });
    } catch {
        res.status(400).json({ error: 'Username/email already exists' });
    }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — Dashboard Stats
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/stats', adminAuth, (req, res) => {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin=0').get().c;
    const totalCoins = db.prepare('SELECT SUM(coins) as s FROM users').get().s || 0;
    const totalHits = db.prepare('SELECT SUM(total_hits) as s FROM users').get().s || 0;
    const totalWithdrawals = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'").get().c;
    const totalAdViews = db.prepare('SELECT SUM(views) as s FROM ads').get().s || 0;
    const totalAdClicks = db.prepare('SELECT SUM(clicks) as s FROM ads').get().s || 0;
    const todayStart = Math.floor(Date.now() / 1000) - 86400;
    const newUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at>? AND is_admin=0').get(todayStart).c;
    res.json({ totalUsers, totalCoins, totalHits, totalWithdrawals, totalAdViews, totalAdClicks, newUsers });
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — Users
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/users', adminAuth, (req, res) => res.json(
    db.prepare('SELECT id,username,email,coins,total_hits,level,is_admin,created_at FROM users ORDER BY coins DESC').all()
));

// ══════════════════════════════════════════════════════════════
//  ADMIN — Leaderboard (full detail)
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/leaderboard', adminAuth, (req, res) => res.json(
    db.prepare(`SELECT u.username,u.email,u.level,l.coins,l.total_hits,l.updated_at
    FROM leaderboard l JOIN users u ON l.user_id=u.id ORDER BY l.coins DESC LIMIT 50`).all()
));

// ══════════════════════════════════════════════════════════════
//  ADMIN — Withdrawals
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/withdrawals', adminAuth, (req, res) =>
    res.json(db.prepare('SELECT * FROM withdrawals ORDER BY created_at DESC').all()));

app.put('/api/admin/withdrawals/:id', adminAuth, (req, res) => {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const wd = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(+req.params.id);
    if (!wd) return res.status(404).json({ error: 'Not found' });
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE withdrawals SET status=?,admin_note=?,updated_at=? WHERE id=?')
        .run(status, adminNote || '', now, +req.params.id);
    // If rejected, refund coins
    if (status === 'rejected') {
        db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(wd.amount, wd.user_id);
        db.prepare('INSERT INTO transactions (user_id,type,amount,description) VALUES(?,?,?,?)')
            .run(wd.user_id, 'earn', wd.amount, `Withdrawal rejected – refunded`);
    }
    res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  ADMIN — Ads Management
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/ads', adminAuth, (req, res) =>
    res.json(db.prepare('SELECT * FROM ads ORDER BY id DESC').all()));

app.post('/api/admin/ads', adminAuth, (req, res) => {
    const { title, description, image_url, link_url, coin_reward } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Title & description required' });
    const r = db.prepare('INSERT INTO ads (title,description,image_url,link_url,coin_reward,active) VALUES(?,?,?,?,?,1)')
        .run(title, description, image_url || '', link_url || '', coin_reward || 10);
    res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/admin/ads/:id', adminAuth, (req, res) => {
    const { title, description, image_url, link_url, coin_reward, active } = req.body;
    db.prepare('UPDATE ads SET title=?,description=?,image_url=?,link_url=?,coin_reward=?,active=? WHERE id=?')
        .run(title, description, image_url || '', link_url || '', coin_reward, active, +req.params.id);
    res.json({ success: true });
});

app.delete('/api/admin/ads/:id', adminAuth, (req, res) => {
    db.prepare('DELETE FROM ads WHERE id=?').run(+req.params.id);
    res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  SERVE FRONTEND
// ══════════════════════════════════════════════════════════════
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🎮 Stone Crush server: http://localhost:${PORT}`));
