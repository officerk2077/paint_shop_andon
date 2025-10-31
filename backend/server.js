// Import các thư viện
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import các module cấu hình
const { PORT, TICK_RATE, DB_CHECK_INTERVAL } = require('./config/appConfig');
const pool = require('./config/database');

// Import service và handlers
const simulationService = require('./services/simulationService');
const apiRoutes = require('./routes/api');
const initializeSocket = require('./socket/socketHandler');

// Khởi tạo Express, HTTP Server và Socket.IO
const app = express();
app.use(express.json());
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// === Logic kiểm tra DB (Giữ ở file chính vì cần cả `pool` và `io`) ===
let dbStatus = 'disconnected';

async function checkDbConnection() {
    try {
        await pool.query('SELECT 1');
        if (dbStatus !== 'connected') {
            dbStatus = 'connected';
            io.emit('db-status-update', dbStatus); // Gửi sự kiện qua io
        }
    } catch (error) {
        if (dbStatus !== 'disconnected') {
            dbStatus = 'disconnected';
            io.emit('db-status-update', dbStatus); // Gửi sự kiện qua io
        }
    }
}
// 1. Đăng ký API routes
app.use('/api', apiRoutes);

// 2. Khởi tạo Socket Handler
// Chúng ta truyền `io`, `simulationService` và một hàm để lấy dbStatus
initializeSocket(io, simulationService, () => dbStatus);

// === Khởi chạy Server ===
server.listen(PORT, async () => {
    console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
    
    // Khởi tạo simulation service (truyền io và pool vào)
    await simulationService.initialize(io, pool);
    simulationService.start();

    // Chạy các tác vụ lặp lại
    setInterval(() => {
        const currentTime = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        io.emit('time-update', currentTime);
    }, TICK_RATE);

    setInterval(checkDbConnection, DB_CHECK_INTERVAL);
});