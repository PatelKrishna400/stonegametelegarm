const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'hit_store_secret_key_2024';

// Database setup
const db = new Database(path.join(__dirname, 'game.db'));

// Initialize tables
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
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    cost INTEGER NOT NULL,
    type TEXT NOT NULL,
    value INTEGER NOT NULL,
    icon TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    upgrade_id INTEGER NOT NULL,
    purchased_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (upgrade_id) REFERENCES upgrades(id)
  );

  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    coins INTEGER NOT NULL,
    total_hits INTEGER NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS store_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    type TEXT NOT NULL,
    value INTEGER NOT NULL,
    icon TEXT NOT NULL,
    available INTEGER DEFAULT 1
  );
`);

// Seed upgrades if empty
const upgradeCount = db.prepare('SELECT COUNT(*) as cnt FROM upgrades').get();
if (upgradeCount.cnt === 0) {
    const insertUpgrade = db.prepare('INSERT INTO upgrades (name, description, cost, type, value, icon) VALUES (?, ?, ?, ?, ?, ?)');
    insertUpgrade.run('Iron Hammer', 'Doubles your hit damage', 500, 'damage', 2, '🔨');
    insertUpgrade.run('Steel Hammer', 'Triples your hit damage', 2000, 'damage', 3, '⚒️');
    insertUpgrade.run('Golden Hammer', '5x your hit damage', 8000, 'damage', 5, '🪙');
    insertUpgrade.run('Diamond Hammer', '10x your hit damage', 25000, 'damage', 10, '💎');
    insertUpgrade.run('Energy Boost I', 'Increase max energy by 50', 300, 'energy', 50, '⚡');
    insertUpgrade.run('Energy Boost II', 'Increase max energy by 100', 1200, 'energy', 100, '⚡');
    insertUpgrade.run('Energy Boost III', 'Increase max energy by 200', 5000, 'energy', 200, '🔋');
    insertUpgrade.run('Lucky Strike', '+50% bonus coins on hits', 3000, 'luck', 50, '🍀');
    insertUpgrade.run('Mega Strike', '+100% bonus coins on hits', 10000, 'luck', 100, '🌟');
}

// Seed store items if empty
const storeCount = db.prepare('SELECT COUNT(*) as cnt FROM store_items').get();
if (storeCount.cnt === 0) {
    const insertItem = db.prepare('INSERT INTO store_items (name, description, price, type, value, icon) VALUES (?, ?, ?, ?, ?, ?)');
    insertItem.run('Energy Refill', 'Fully restore your energy', 200, 'energy_refill', 100, '⚡');
    insertItem.run('Coin Multiplier (1h)', 'Double coins for 1 hour', 1000, 'multiplier', 2, '💰');
    insertItem.run('Auto Clicker (10min)', 'Auto-hits the store for 10 minutes', 1500, 'auto_click', 10, '🤖');
    insertItem.run('Lucky Box', 'Win a random amount of coins (100-5000)', 500, 'lucky_box', 5000, '🎁');
    insertItem.run('XP Boost (1h)', 'Double XP for 1 hour', 800, 'xp_boost', 2, '✨');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// Energy regeneration helper
function regenEnergy(user) {
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - user.last_energy_time;
    const regenRate = 1; // 1 energy per second
    const regenAmount = Math.floor(elapsed * regenRate);
    const newEnergy = Math.min(user.energy + regenAmount, user.max_energy);
    if (regenAmount > 0) {
        db.prepare('UPDATE users SET energy = ?, last_energy_time = ? WHERE id = ?').run(newEnergy, now, user.id);
        user.energy = newEnergy;
        user.last_energy_time = now;
    }
    return user;
}

// XP required for next level
function xpForLevel(level) {
    return level * level * 100;
}

// ===================== AUTH ROUTES =====================

app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    try {
        const hashedPw = bcrypt.hashSync(password, 10);
        const stmt = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');
        const result = stmt.run(username, email, hashedPw);
        db.prepare('INSERT INTO leaderboard (user_id, coins, total_hits) VALUES (?, 0, 0)').run(result.lastInsertRowid);
        const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: result.lastInsertRowid, username });
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Username or email already exists' });
        } else {
            res.status(500).json({ error: 'Server error' });
        }
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user.id, username: user.username });
});

// ===================== USER ROUTES =====================

app.get('/api/user/profile', authMiddleware, (req, res) => {
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user = regenEnergy(user);
    const { password, ...safeUser } = user;
    safeUser.xpNeeded = xpForLevel(safeUser.level);
    // Get owned upgrade IDs
    const ownedUpgrades = db.prepare('SELECT upgrade_id FROM user_upgrades WHERE user_id = ?').all(req.userId).map(u => u.upgrade_id);
    safeUser.ownedUpgrades = ownedUpgrades;
    res.json(safeUser);
});

// ===================== GAME ROUTES =====================

app.post('/api/game/hit', authMiddleware, (req, res) => {
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user = regenEnergy(user);

    if (user.energy < 1) {
        return res.status(400).json({ error: 'Not enough energy!' });
    }

    // Calculate damage/coins based on hammer level and upgrades
    const ownedUpgrades = db.prepare(`
    SELECT u.type, u.value FROM user_upgrades pu
    JOIN upgrades u ON pu.upgrade_id = u.id
    WHERE pu.user_id = ?
  `).all(req.userId);

    let damageMultiplier = 1;
    let luckBonus = 0;
    for (const upg of ownedUpgrades) {
        if (upg.type === 'damage') damageMultiplier = Math.max(damageMultiplier, upg.value);
        if (upg.type === 'luck') luckBonus += upg.value;
    }

    const baseCoins = user.hammer_level * damageMultiplier;
    const luckyExtra = Math.random() < (luckBonus / 100) ? Math.floor(baseCoins * 0.5) : 0;
    const coinsEarned = baseCoins + luckyExtra;
    const xpEarned = Math.floor(coinsEarned * 0.5) + 1;
    const newEnergy = user.energy - 1;
    const newCoins = user.coins + coinsEarned;
    const newTotalHits = user.total_hits + 1;
    let newXp = user.xp + xpEarned;
    let newLevel = user.level;
    let leveledUp = false;

    // Level up check
    while (newXp >= xpForLevel(newLevel)) {
        newXp -= xpForLevel(newLevel);
        newLevel++;
        leveledUp = true;
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE users SET coins = ?, total_hits = ?, xp = ?, level = ?, energy = ?, last_energy_time = ?
    WHERE id = ?
  `).run(newCoins, newTotalHits, newXp, newLevel, newEnergy, now, req.userId);

    // Update leaderboard (proper upsert)
    db.prepare(`
    INSERT INTO leaderboard (user_id, coins, total_hits, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET coins = excluded.coins, total_hits = excluded.total_hits, updated_at = excluded.updated_at
  `).run(req.userId, newCoins, newTotalHits, now);

    // Log transaction
    db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)')
        .run(req.userId, 'earn', coinsEarned, `Hit the store! +${coinsEarned} coins`);

    res.json({
        coinsEarned,
        luckyExtra,
        xpEarned,
        newCoins,
        newEnergy,
        newXp,
        newLevel,
        leveledUp,
        xpNeeded: xpForLevel(newLevel),
        totalHits: newTotalHits
    });
});

// ===================== UPGRADES ROUTES =====================

app.get('/api/upgrades', authMiddleware, (req, res) => {
    const all = db.prepare('SELECT * FROM upgrades').all();
    const owned = db.prepare('SELECT upgrade_id FROM user_upgrades WHERE user_id = ?').all(req.userId).map(u => u.upgrade_id);
    const result = all.map(u => ({ ...u, owned: owned.includes(u.id) }));
    res.json(result);
});

app.post('/api/upgrades/buy/:id', authMiddleware, (req, res) => {
    const upgradeId = parseInt(req.params.id);
    const upgrade = db.prepare('SELECT * FROM upgrades WHERE id = ?').get(upgradeId);
    if (!upgrade) return res.status(404).json({ error: 'Upgrade not found' });

    const owned = db.prepare('SELECT id FROM user_upgrades WHERE user_id = ? AND upgrade_id = ?').get(req.userId, upgradeId);
    if (owned) return res.status(400).json({ error: 'Already owned' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (user.coins < upgrade.cost) return res.status(400).json({ error: 'Not enough coins' });

    const newCoins = user.coins - upgrade.cost;
    db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(newCoins, req.userId);
    db.prepare('INSERT INTO user_upgrades (user_id, upgrade_id) VALUES (?, ?)').run(req.userId, upgradeId);

    // If energy upgrade, increase max_energy
    if (upgrade.type === 'energy') {
        db.prepare('UPDATE users SET max_energy = max_energy + ? WHERE id = ?').run(upgrade.value, req.userId);
    }

    db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)')
        .run(req.userId, 'spend', upgrade.cost, `Bought upgrade: ${upgrade.name}`);

    res.json({ success: true, newCoins });
});

// ===================== STORE ROUTES =====================

app.get('/api/store', authMiddleware, (req, res) => {
    const items = db.prepare('SELECT * FROM store_items WHERE available = 1').all();
    res.json(items);
});

app.post('/api/store/buy/:id', authMiddleware, (req, res) => {
    const itemId = parseInt(req.params.id);
    const item = db.prepare('SELECT * FROM store_items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (user.coins < item.price) return res.status(400).json({ error: 'Not enough coins' });

    const newCoins = user.coins - item.price;
    let updateMsg = '';
    let luckyWin = 0;

    if (item.type === 'energy_refill') {
        db.prepare('UPDATE users SET coins = ?, energy = max_energy WHERE id = ?').run(newCoins, req.userId);
        updateMsg = 'Energy fully restored!';
    } else if (item.type === 'lucky_box') {
        luckyWin = Math.floor(Math.random() * 5000) + 100;
        db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(newCoins + luckyWin, req.userId);
        updateMsg = `Lucky Box opened! You won ${luckyWin} coins!`;
    } else {
        db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(newCoins, req.userId);
        updateMsg = `${item.name} activated!`;
    }

    db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)')
        .run(req.userId, 'spend', item.price, `Bought store item: ${item.name}`);

    res.json({ success: true, newCoins: item.type === 'lucky_box' ? newCoins + luckyWin : newCoins, message: updateMsg, luckyWin });
});

// ===================== LEADERBOARD =====================

app.get('/api/leaderboard', (req, res) => {
    const top = db.prepare(`
    SELECT u.username, l.coins, l.total_hits, u.level, u.hammer_level
    FROM leaderboard l
    JOIN users u ON l.user_id = u.id
    ORDER BY l.coins DESC
    LIMIT 20
  `).all();
    res.json(top);
});

// ===================== TRANSACTIONS =====================

app.get('/api/transactions', authMiddleware, (req, res) => {
    const txns = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.userId);
    res.json(txns);
});

// Serve frontend
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🎮 Hit Store Game Server running at http://localhost:${PORT}`);
});
