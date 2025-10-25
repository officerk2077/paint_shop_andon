const TICK_RATE = 1000;
const DB_CHECK_INTERVAL = 5000;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');
const simulationService = require('./services/simulationService');

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

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '3011',
    database: 'paint_shop_andon',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);
console.log('✅ Pool kết nối database đã được tạo.');

let dbStatus = 'disconnected';

async function checkDbConnection() {
    try {
        await pool.query('SELECT 1');
        if (dbStatus !== 'connected') {
            dbStatus = 'connected';
            io.emit('db-status-update', dbStatus);
        }
    } catch (error) {
        if (dbStatus !== 'disconnected') {
            dbStatus = 'disconnected';
            io.emit('db-status-update', dbStatus);
        }
    }
}

app.post('/api/vehicles', async (req, res) => {
    const { body_id } = req.body;
    if (!body_id) {
        return res.status(400).json({ error: 'Mã thân xe (body_id) là bắt buộc.' });
    }
    try {
        await simulationService.addVehicle(body_id);
        res.status(201).json({ message: `Đã thêm xe ${body_id} thành công.` });
    } catch (error) {
        res.status(500).json({ error: `Không thể thêm xe. ${error.message}` });
    }
});

app.get('/api/logs', async (req, res) => {
    try {
        const query = 'SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50'; // Sắp xếp mới nhất lên đầu
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Lỗi khi lấy logs:', error);
        res.status(500).json({ error: 'Không thể lấy dữ liệu logs.' });
    }
});

io.on('connection', (socket) => {
    console.log(`🔌 Một người dùng đã kết nối: ${socket.id}`);
    
    socket.emit('initial-state', simulationService.getState());
    socket.emit('db-status-update', dbStatus);
    
    socket.on('add-vehicle', async (bodyId) => {
        if (!bodyId) return;
        try {
            await simulationService.addVehicle(bodyId);
        } catch (error) {
            socket.emit('add-vehicle-error', { message: `Không thể thêm xe ${bodyId}. ${error.message}` });
        }
    });

    socket.on('report-operational-error', (stationId) => {
        simulationService.reportOperationalError(stationId);
    });

    socket.on('emergency-stop', async () => {
        if (simulationService.emergencyStopAndClear) {
            await simulationService.emergencyStopAndClear();
            io.emit('action-confirmed', { 
                message: 'Dây chuyền đã dừng và tất cả xe đã được xóa.',
                type: 'error'
            });
        }
    });

    socket.on('pause-line', async () => {
        if (simulationService.pauseLine) {
            await simulationService.pauseLine();
        }
    });

    socket.on('play-line', async () => {
        if (simulationService.playLine) {
            await simulationService.playLine();
        }
    });

    socket.on('remove-vehicle', async (bodyId) => {
        console.log(`[Socket] Nhận yêu cầu xóa xe: ${bodyId}`);
        if (!bodyId) {
            socket.emit('action-error', { message: 'Mã xe không hợp lệ.' });
            return;
        }
        try {
            await simulationService.removeVehicle(bodyId);
            // Gửi xác nhận thành công (có thể gửi cho tất cả hoặc chỉ người yêu cầu)
            // io.emit('action-confirmed', { message: `Xe ${bodyId} đã được xóa.`, type: 'info' });
             socket.emit('action-confirmed', { message: `Xe ${bodyId} đã được xóa.`, type: 'info' });
        } catch (error) {
            console.error(`[Socket] Lỗi khi xóa xe ${bodyId}:`, error);
            socket.emit('action-error', { message: `Không thể xóa xe ${bodyId}. ${error.message}` });
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Người dùng đã ngắt kết nối: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
    console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
    
    await simulationService.initialize(io, pool);
    
    // --- CẬP NHẬT 2: KÍCH HOẠT LẠI MÔ PHỎNG DI CHUYỂN XE ---
    simulationService.start();

    setInterval(() => {
        const currentTime = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        io.emit('time-update', currentTime);
    }, TICK_RATE);

    setInterval(checkDbConnection, DB_CHECK_INTERVAL);
});