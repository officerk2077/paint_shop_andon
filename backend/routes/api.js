const express = require('express');
const router = express.Router();
const pool = require('../config/database'); // Import pool
const simulationService = require('../services/simulationService'); // Import service

// POST /api/vehicles
router.post('/vehicles', async (req, res) => {
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

// GET /api/logs
router.get('/logs', async (req, res) => {
    try {
        const query = 'SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50';
        const [rows] = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Lỗi khi lấy logs:', error);
        res.status(500).json({ error: 'Không thể lấy dữ liệu logs.' });
    }
});

// GET /api/error-logs
router.get('/error-logs', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT 
                e.id, 
                e.body_id, 
                e.start_time AS timestamp,
                e.manual_description,
                e.decision, 
                s.name AS station_name,
                cb.model_name
            FROM error_logs e
            JOIN stations s ON e.station_id = s.id
            LEFT JOIN car_bodies cb ON e.body_id = cb.body_id
            WHERE e.decision IN ('OK (Lỗi nhẹ)', 'NG (Sơn lại)')
            ORDER BY e.start_time DESC
            LIMIT 100` 
        );
        
        const logsWithDescription = rows.map(log => ({
            ...log,
            error_description: log.manual_description || 'N/A'
        }));
        res.json(logsWithDescription);
    } catch (error) {
        console.error('Lỗi khi truy vấn error_logs:', error); 
        res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
    }
});

module.exports = router;