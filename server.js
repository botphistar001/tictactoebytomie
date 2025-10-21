const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const NodeCache = require('node-cache');

// ==================== CONFIGURATION ====================
const IS_RENDER = process.env.RENDER === 'true' || process.env.RENDER_EXTERNAL_URL !== undefined;
const PORT = process.env.PORT || 3000;
const RENDER_DOMAIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Auto-detect domain name
function getShortDomainName() {
    if (!RENDER_DOMAIN) return 'local';
    
    let domain = RENDER_DOMAIN.replace(/^https?:\/\//, '');
    domain = domain.replace(/\.render\.com$/, '');
    domain = domain.replace(/\.onrender\.com$/, '');
    domain = domain.split('.')[0];
    
    return domain || 'local';
}

const SHORT_DOMAIN = getShortDomainName();

const config = {
    webPort: PORT,
    webBaseUrl: RENDER_DOMAIN,
    maxMemoryMB: 450,
    cleanupInterval: 30 * 60 * 1000,
    backupInterval: 60 * 60 * 1000
};

// ==================== DATABASE SETUP ====================
const DB_PATH = path.join(__dirname, 'database.json');

function initDatabase() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            const initialData = {
                users: {},
                games: {},
                gameInvites: {},
                statistics: {
                    totalUsers: 0,
                    totalGames: 0,
                    gamesPlayed: 0,
                    startupCount: 0,
                    domain: SHORT_DOMAIN,
                    usersToday: 0,
                    lastReset: new Date().toISOString().split('T')[0]
                },
                settings: {
                    welcomeMessage: "🎮 Welcome to Tic Tac Toe Pro - The Ultimate Multiplayer Experience!",
                    webWelcomeMessage: "🏆 Welcome to your Game Dashboard!",
                    maxPlayersPerGame: 2,
                    gameTimeout: 300 // 5 minutes
                },
                onlineUsers: {},
                activeGames: {},
                version: '1.0'
            };
            fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
            console.log('✅ Database initialized');
        } else {
            const db = readDatabase();
            if (!db.settings) db.settings = {};
            if (!db.games) db.games = {};
            if (!db.gameInvites) db.gameInvites = {};
            if (!db.onlineUsers) db.onlineUsers = {};
            if (!db.activeGames) db.activeGames = {};
            writeDatabase(db);
        }
        
        const db = readDatabase();
        db.statistics.startupCount = (db.statistics.startupCount || 0) + 1;
        db.statistics.lastStartup = new Date().toISOString();
        db.statistics.domain = SHORT_DOMAIN;
        
        const today = new Date().toISOString().split('T')[0];
        if (db.statistics.lastReset !== today) {
            db.statistics.usersToday = 0;
            db.statistics.lastReset = today;
        }
        
        writeDatabase(db);
        
        console.log(`🎮 Tic Tac Toe Pro Database Connected`);
        console.log(`🌐 Domain: ${SHORT_DOMAIN}`);
        
    } catch (error) {
        console.error('❌ Error initializing database:', error);
    }
}

function readDatabase() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Error reading database:', error);
        return { users: {}, games: {}, gameInvites: {}, statistics: {}, settings: {}, onlineUsers: {}, activeGames: {} };
    }
}

function writeDatabase(data) {
    try {
        data.statistics = data.statistics || {};
        data.statistics.totalUsers = Object.keys(data.users || {}).length;
        data.statistics.lastUpdate = new Date().toISOString();
        data.statistics.domain = SHORT_DOMAIN;
        
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error writing database:', error);
        return false;
    }
}

// ==================== USER MANAGEMENT ====================
function getUser(userId) {
    const db = readDatabase();
    return db.users[userId] || null;
}

function createOrUpdateUser(userId, userData) {
    const db = readDatabase();
    const isNewUser = !db.users[userId];
    
    if (!db.users[userId]) {
        db.users[userId] = {
            id: userId,
            firstName: '',
            lastName: '',
            username: '',
            email: '',
            createdAt: new Date().toISOString(),
            stats: {
                gamesPlayed: 0,
                gamesWon: 0,
                gamesLost: 0,
                gamesDrawn: 0,
                winStreak: 0,
                bestWinStreak: 0
            },
            ...userData
        };
        console.log(`✅ New user created: ${userId}`);
        
        const today = new Date().toISOString().split('T')[0];
        if (db.statistics.lastReset !== today) {
            db.statistics.usersToday = 0;
            db.statistics.lastReset = today;
        }
        db.statistics.usersToday = (db.statistics.usersToday || 0) + 1;
    } else {
        db.users[userId] = { ...db.users[userId], ...userData };
        console.log(`✅ User updated: ${userId}`);
    }
    
    return writeDatabase(db);
}

function setUserProfile(userId, firstName, lastName, username, email) {
    return createOrUpdateUser(userId, { 
        firstName: firstName,
        lastName: lastName,
        username: username,
        email: email,
        profileCompleted: true,
        lastUpdated: new Date().toISOString()
    });
}

function updateUserStats(userId, result) {
    const db = readDatabase();
    const user = db.users[userId];
    
    if (user) {
        user.stats.gamesPlayed++;
        
        if (result === 'win') {
            user.stats.gamesWon++;
            user.stats.winStreak++;
            if (user.stats.winStreak > user.stats.bestWinStreak) {
                user.stats.bestWinStreak = user.stats.winStreak;
            }
        } else if (result === 'loss') {
            user.stats.gamesLost++;
            user.stats.winStreak = 0;
        } else if (result === 'draw') {
            user.stats.gamesDrawn++;
            user.stats.winStreak = 0;
        }
        
        writeDatabase(db);
    }
}

function getOnlineUsers() {
    const db = readDatabase();
    return Object.values(db.onlineUsers || {});
}

function setUserOnline(userId, socketId) {
    const db = readDatabase();
    const user = db.users[userId];
    
    if (user) {
        db.onlineUsers[userId] = {
            ...user,
            socketId: socketId,
            lastSeen: new Date().toISOString(),
            status: 'online'
        };
        writeDatabase(db);
        return true;
    }
    return false;
}

function setUserOffline(userId) {
    const db = readDatabase();
    if (db.onlineUsers[userId]) {
        delete db.onlineUsers[userId];
        writeDatabase(db);
        return true;
    }
    return false;
}

// ==================== GAME MANAGEMENT ====================
function createGame(player1, player2) {
    const db = readDatabase();
    const gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const game = {
        id: gameId,
        player1: player1,
        player2: player2,
        board: Array(9).fill(null),
        currentPlayer: 'X', // Player1 is X, Player2 is O
        status: 'playing',
        winner: null,
        winningLine: null,
        moves: [],
        createdAt: new Date().toISOString(),
        lastMoveAt: new Date().toISOString()
    };
    
    db.games[gameId] = game;
    db.activeGames[gameId] = game;
    db.statistics.totalGames = (db.statistics.totalGames || 0) + 1;
    
    writeDatabase(db);
    return game;
}

function getGame(gameId) {
    const db = readDatabase();
    return db.games[gameId] || null;
}

function updateGame(gameId, updates) {
    const db = readDatabase();
    if (db.games[gameId]) {
        db.games[gameId] = { ...db.games[gameId], ...updates };
        
        if (updates.status === 'finished' && db.activeGames[gameId]) {
            delete db.activeGames[gameId];
        }
        
        writeDatabase(db);
        return true;
    }
    return false;
}

function makeMove(gameId, cellIndex, player) {
    const db = readDatabase();
    const game = db.games[gameId];
    
    if (!game || game.status !== 'playing' || game.board[cellIndex] !== null) {
        return false;
    }
    
    // Check if it's the player's turn
    const expectedPlayer = game.currentPlayer;
    const playerSymbol = game.player1.id === player ? 'X' : 'O';
    
    if (playerSymbol !== expectedPlayer) {
        return false;
    }
    
    // Make the move
    game.board[cellIndex] = playerSymbol;
    game.moves.push({
        player: player,
        symbol: playerSymbol,
        cellIndex: cellIndex,
        timestamp: new Date().toISOString()
    });
    
    game.lastMoveAt = new Date().toISOString();
    
    // Check for winner
    const winner = checkWinner(game.board);
    if (winner) {
        game.status = 'finished';
        game.winner = winner.winner;
        game.winningLine = winner.line;
        
        // Update player stats
        if (winner.winner === 'X') {
            updateUserStats(game.player1.id, 'win');
            updateUserStats(game.player2.id, 'loss');
        } else if (winner.winner === 'O') {
            updateUserStats(game.player1.id, 'loss');
            updateUserStats(game.player2.id, 'win');
        }
        
        db.statistics.gamesPlayed = (db.statistics.gamesPlayed || 0) + 1;
    } else if (game.board.every(cell => cell !== null)) {
        // Draw
        game.status = 'finished';
        game.winner = 'draw';
        updateUserStats(game.player1.id, 'draw');
        updateUserStats(game.player2.id, 'draw');
        db.statistics.gamesPlayed = (db.statistics.gamesPlayed || 0) + 1;
    } else {
        // Switch turns
        game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
    }
    
    writeDatabase(db);
    return true;
}

function checkWinner(board) {
    const winningCombinations = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6] // diagonals
    ];
    
    for (let [a, b, c] of winningCombinations) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return {
                winner: board[a],
                line: [a, b, c]
            };
        }
    }
    return null;
}

// ==================== GAME INVITES ====================
function createGameInvite(fromUserId, toUserId) {
    const db = readDatabase();
    const inviteId = 'invite_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    const invite = {
        id: inviteId,
        fromUserId: fromUserId,
        toUserId: toUserId,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    db.gameInvites[inviteId] = invite;
    writeDatabase(db);
    return invite;
}

function getPendingInvites(userId) {
    const db = readDatabase();
    return Object.values(db.gameInvites || {}).filter(invite => 
        invite.toUserId === userId && invite.status === 'pending'
    );
}

function updateInviteStatus(inviteId, status) {
    const db = readDatabase();
    if (db.gameInvites[inviteId]) {
        db.gameInvites[inviteId].status = status;
        db.gameInvites[inviteId].updatedAt = new Date().toISOString();
        writeDatabase(db);
        return true;
    }
    return false;
}

// ==================== STATISTICS ====================
function getStatistics() {
    const db = readDatabase();
    const users = Object.values(db.users);
    
    const today = new Date().toISOString().split('T')[0];
    const usersCreatedToday = users.filter(user => 
        user.createdAt && user.createdAt.startsWith(today)
    ).length;
    
    const activeGames = Object.values(db.activeGames || {}).length;
    const onlineUsers = Object.values(db.onlineUsers || {}).length;
    
    return {
        totalUsers: users.length,
        usersToday: usersCreatedToday,
        onlineUsers: onlineUsers,
        activeGames: activeGames,
        totalGames: db.statistics.totalGames || 0,
        gamesPlayed: db.statistics.gamesPlayed || 0,
        lastUpdate: db.statistics.lastUpdate,
        startupCount: db.statistics.startupCount,
        domain: SHORT_DOMAIN
    };
}

// ==================== EXPRESS SERVER SETUP ====================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));
app.use('/styles', express.static(path.join(__dirname, 'views', 'styles')));

// ==================== ROUTES ====================

// Home Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Registration Form
app.get('/register/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const user = getUser(userId);
        
        if (user && user.profileCompleted) {
            return res.redirect(`/dashboard/${userId}`);
        }
        
        res.sendFile(path.join(__dirname, 'views', 'registration.html'));
        
    } catch (error) {
        console.error('Registration form error:', error);
        res.status(500).send('Internal server error');
    }
});

// Handle Registration
app.post('/register/:userId', express.json(), (req, res) => {
    try {
        const userId = req.params.userId;
        const { firstName, lastName, username, email } = req.body;
        
        console.log(`📝 Registration form submitted for ${userId}`);
        
        if (!firstName || !lastName || !username || !email) {
            return res.json({ 
                success: false, 
                error: 'All fields are required' 
            });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.json({ 
                success: false, 
                error: 'Please enter a valid email address' 
            });
        }
        
        const success = setUserProfile(userId, firstName, lastName, username, email);
        
        if (success) {
            console.log(`✅ User registered: ${userId}`);
            
            res.json({ 
                success: true, 
                message: 'Account created successfully!',
                redirectUrl: `/dashboard/${userId}`
            });
        } else {
            res.json({ 
                success: false, 
                error: 'Failed to create account' 
            });
        }
        
    } catch (error) {
        console.error('Registration submission error:', error);
        res.json({ 
            success: false, 
            error: 'Internal server error' 
        });
    }
});

// Dashboard
app.get('/dashboard/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const user = getUser(userId);
        
        if (!user || !user.profileCompleted) {
            return res.redirect(`/register/${userId}`);
        }

        res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Internal server error');
    }
});

// Game Page
app.get('/game/:gameId/:userId', (req, res) => {
    try {
        const { gameId, userId } = req.params;
        const user = getUser(userId);
        const game = getGame(gameId);
        
        if (!user || !game) {
            return res.status(404).send('Game or user not found');
        }

        res.sendFile(path.join(__dirname, 'views', 'game.html'));
        
    } catch (error) {
        console.error('Game page error:', error);
        res.status(500).send('Internal server error');
    }
});

// API Routes
app.get('/api/user/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const user = getUser(userId);
        
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            user: user
        });
        
    } catch (error) {
        console.error('API user error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/online-users', (req, res) => {
    try {
        const onlineUsers = getOnlineUsers();
        res.json({
            success: true,
            users: onlineUsers
        });
    } catch (error) {
        console.error('Online users API error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/send-invite', express.json(), (req, res) => {
    try {
        const { fromUserId, toUserId } = req.body;
        
        if (!fromUserId || !toUserId) {
            return res.json({ 
                success: false, 
                error: 'Missing user IDs' 
            });
        }
        
        const invite = createGameInvite(fromUserId, toUserId);
        
        // Notify the recipient via socket
        const db = readDatabase();
        const toUserSocketId = db.onlineUsers[toUserId]?.socketId;
        
        if (toUserSocketId) {
            const fromUser = getUser(fromUserId);
            io.to(toUserSocketId).emit('game_invite', {
                inviteId: invite.id,
                fromUser: fromUser,
                message: `${fromUser.username} invited you to play Tic Tac Toe!`
            });
        }
        
        res.json({
            success: true,
            invite: invite
        });
        
    } catch (error) {
        console.error('Send invite error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/respond-invite', express.json(), (req, res) => {
    try {
        const { inviteId, response, userId } = req.body;
        
        if (!inviteId || !response) {
            return res.json({ 
                success: false, 
                error: 'Missing required parameters' 
            });
        }
        
        const success = updateInviteStatus(inviteId, response);
        
        if (success && response === 'accepted') {
            const db = readDatabase();
            const invite = db.gameInvites[inviteId];
            
            if (invite) {
                // Create game
                const fromUser = getUser(invite.fromUserId);
                const toUser = getUser(invite.toUserId);
                
                const game = createGame(fromUser, toUser);
                
                // Notify both players
                const fromSocketId = db.onlineUsers[fromUser.id]?.socketId;
                const toSocketId = db.onlineUsers[toUser.id]?.socketId;
                
                if (fromSocketId) {
                    io.to(fromSocketId).emit('invite_accepted', {
                        gameId: game.id,
                        opponent: toUser
                    });
                }
                
                if (toSocketId) {
                    io.to(toSocketId).emit('game_started', {
                        gameId: game.id,
                        opponent: fromUser
                    });
                }
                
                res.json({
                    success: true,
                    gameId: game.id,
                    message: 'Game created successfully'
                });
                return;
            }
        }
        
        res.json({
            success: true,
            message: `Invite ${response}`
        });
        
    } catch (error) {
        console.error('Respond invite error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/pending-invites/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const invites = getPendingInvites(userId);
        
        // Add from user details to invites
        const invitesWithUsers = invites.map(invite => {
            const fromUser = getUser(invite.fromUserId);
            return {
                ...invite,
                fromUser: fromUser
            };
        });
        
        res.json({
            success: true,
            invites: invitesWithUsers
        });
        
    } catch (error) {
        console.error('Pending invites error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/game/:gameId', (req, res) => {
    try {
        const gameId = req.params.gameId;
        const game = getGame(gameId);
        
        if (!game) {
            return res.json({ success: false, error: 'Game not found' });
        }
        
        res.json({
            success: true,
            game: game
        });
        
    } catch (error) {
        console.error('Game API error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/statistics', (req, res) => {
    try {
        const stats = getStatistics();
        res.json({ success: true, statistics: stats });
    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    const db = readDatabase();
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        statistics: db.statistics,
        domain: SHORT_DOMAIN
    });
});

// ==================== SOCKET.IO HANDLING ====================
io.on('connection', (socket) => {
    console.log(`🔗 User connected: ${socket.id}`);
    
    socket.on('user_online', (userId) => {
        console.log(`👤 User ${userId} came online`);
        setUserOnline(userId, socket.id);
        
        // Broadcast to all users that this user is online
        socket.broadcast.emit('user_status_changed', {
            userId: userId,
            status: 'online'
        });
        
        // Send current online users to the connected user
        const onlineUsers = getOnlineUsers();
        socket.emit('online_users', onlineUsers);
    });
    
    socket.on('join_game', (gameId) => {
        socket.join(gameId);
        console.log(`🎮 User ${socket.id} joined game ${gameId}`);
    });
    
    socket.on('make_move', (data) => {
        const { gameId, cellIndex, userId } = data;
        console.log(`🎯 Move made in game ${gameId}: cell ${cellIndex} by user ${userId}`);
        
        const success = makeMove(gameId, cellIndex, userId);
        
        if (success) {
            const game = getGame(gameId);
            
            // Broadcast move to all players in the game
            io.to(gameId).emit('move_made', {
                game: game,
                cellIndex: cellIndex,
                player: userId
            });
            
            // If game is finished, notify players
            if (game.status === 'finished') {
                io.to(gameId).emit('game_finished', {
                    game: game,
                    winner: game.winner,
                    winningLine: game.winningLine
                });
            }
        } else {
            socket.emit('move_error', {
                error: 'Invalid move'
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.id}`);
        
        // Find user by socket ID and set offline
        const db = readDatabase();
        const onlineUsers = db.onlineUsers || {};
        
        for (const [userId, user] of Object.entries(onlineUsers)) {
            if (user.socketId === socket.id) {
                setUserOffline(userId);
                
                // Broadcast that user went offline
                socket.broadcast.emit('user_status_changed', {
                    userId: userId,
                    status: 'offline'
                });
                break;
            }
        }
    });
});

// ==================== AUTO-PING SYSTEM ====================
function startAutoPing() {
    if (!IS_RENDER) {
        console.log('🚫 Auto-ping disabled (not on Render)');
        return;
    }

    const pingInterval = 14 * 60 * 1000;
    
    async function pingServer() {
        try {
            const response = await axios.get(`${config.webBaseUrl}/health`, { timeout: 10000 });
            console.log(`✅ Auto-ping successful: ${response.data.status}`);
        } catch (error) {
            console.warn(`⚠️ Auto-ping failed: ${error.message}`);
        }
    }

    setTimeout(() => {
        pingServer();
        setInterval(pingServer, pingInterval);
    }, 60000);

    console.log(`🔄 Auto-ping started for Render (every ${pingInterval/60000} minutes)`);
}

// ==================== MEMORY MANAGEMENT ====================
const memoryCache = new NodeCache({ 
    stdTTL: 3600,
    checkperiod: 600
});

function startMemoryCleanup() {
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
        
        console.log(`🧠 Memory usage: ${heapUsedMB.toFixed(2)}MB / ${config.maxMemoryMB}MB`);
        
        if (heapUsedMB > config.maxMemoryMB * 0.8) {
            console.log('⚠️ High memory usage detected, running cleanup...');
            performMemoryCleanup();
        }
        
    }, config.cleanupInterval);
}

function performMemoryCleanup() {
    try {
        memoryCache.flushAll();
        
        if (global.gc) {
            global.gc();
            console.log('🗑️ Manual garbage collection performed');
        }
        
        console.log('✅ Memory cleanup completed');
        
    } catch (error) {
        console.error('Memory cleanup error:', error);
    }
}

// ==================== START SERVER ====================
function startServer() {
    try {
        console.log('🚀 Starting Tic Tac Toe Pro Multiplayer Game...');
        console.log(`🌐 Domain: ${SHORT_DOMAIN}`);
        console.log(`🔗 URL: ${config.webBaseUrl}`);
        
        initDatabase();
        
        server.listen(config.webPort, '0.0.0.0', () => {
            console.log(`✅ Game server running on port ${config.webPort}`);
            console.log(`🎮 Home: ${config.webBaseUrl}`);
            console.log(`📊 Dashboard: ${config.webBaseUrl}/dashboard/{userId}`);
            console.log(`📝 Registration: ${config.webBaseUrl}/register/{userId}`);
            console.log(`🎯 Game: ${config.webBaseUrl}/game/{gameId}/{userId}`);
            console.log(`🏥 Health: ${config.webBaseUrl}/health`);
        });

        startAutoPing();
        startMemoryCleanup();

        console.log('✅ Tic Tac Toe Pro is ready for players!');
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start everything
startServer();
