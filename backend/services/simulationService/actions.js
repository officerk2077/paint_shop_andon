// File: services/simulationService/actions.js

const { SELECT_VEHICLES_QUERY, BUFFER_STATION_ID, OFFLINE_REPAIR_ID } = require('./constants');

/**
 * Tạm dừng dây chuyền (trừ các lò sấy và trạm đặc biệt)
 */
async function pauseLine(context) {
    context.isPausedForNonOvens = true;
    console.log('Dây chuyền tạm dừng (trừ lò sấy).');
    await context.logEvent('warning', 'Dây chuyền đã tạm dừng (trừ lò sấy).');
    if (context.io) context.io.emit('line-status-update', 'paused');
}

/**
 * Tiếp tục chạy dây chuyền
 */
async function playLine(context) {
    context.isPausedForNonOvens = false;
    console.log('Dây chuyền tiếp tục.');
    await context.logEvent('info', 'Dây chuyền đã hoạt động trở lại.');
    if (context.io) context.io.emit('line-status-update', 'running');
}

/**
 * Thêm một xe mới vào buffer
 */
async function addVehicle(context, body_id) {
    const { pool, activeVehicles, logEvent, updateAndBroadcastState } = context;
    if (!body_id) throw new Error('Mã thân xe (body_id) là bắt buộc.');

    const [bodyRows] = await pool.query('SELECT * FROM car_bodies WHERE body_id = ?', [body_id]);
    if (bodyRows.length === 0) {
        await logEvent('error', `Lỗi thêm xe ${body_id}: Mã thân xe không tồn tại.`);
        throw new Error(`Mã thân xe "${body_id}" không tồn tại.`);
    }

    if (activeVehicles.some(v => v && v.body_id === body_id)) {
        await logEvent('error', `Lỗi thêm xe ${body_id}: Xe đã có trong dây chuyền.`);
        throw new Error(`Xe "${body_id}" đã có trong dây chuyền.`);
    }

    try {
        const now = Date.now();
        const [result] = await pool.execute(
            'INSERT INTO vehicles (body_id, current_station_id, status, primer_lap_count, slot_position, stationEntryTime, slotEntryTime) VALUES (?, ?, "ok", 0, 0, ?, ?)',
            [body_id, BUFFER_STATION_ID, new Date(now), new Date(now)]
        );

        const [newVehicleRows] = await pool.query(SELECT_VEHICLES_QUERY + ' WHERE v.id = ?', [result.insertId]);
        activeVehicles.push({
            ...newVehicleRows[0],
            stationEntryTime: now,
            slotEntryTime: now
        });

        await logEvent('success', `Thêm xe mới: ${body_id} vào buffer chờ.`);
        updateAndBroadcastState();
    } catch (error) {
        console.error(`Lỗi khi thêm xe ${body_id}:`, error);
        await logEvent('error', `Lỗi thêm xe ${body_id}: ${error.message}`);
        throw error;
    }
}

/**
 * Xóa một xe khỏi dây chuyền
 */
async function removeVehicle(context, body_id) {
    const { pool, activeVehicles, logEvent, updateAndBroadcastState, io } = context;
    const index = activeVehicles.findIndex(v => v && v.body_id === body_id);
    if (index === -1) {
        throw new Error(`Xe ${body_id} không có trong dây chuyền.`);
    }

    try {
        await pool.execute('DELETE FROM vehicles WHERE body_id = ?', [body_id]);
        activeVehicles.splice(index, 1);
        await logEvent('warning', `Xe ${body_id} đã bị xóa khỏi trạm/buffer.`);
        if (io) io.emit('action-confirmed', { message: `Xe ${body_id} đã bị xóa.`, type: 'info' });
        updateAndBroadcastState();
    } catch (error) {
        console.error(`Lỗi DB khi xóa xe ${body_id}:`, error);
        await logEvent('error', `Lỗi DB khi xóa xe ${body_id}: ${error.message}`);
        throw new Error(`Không thể xóa xe khỏi CSDL. ${error.message}`);
    }
}

/**
 * Dừng khẩn cấp và xóa tất cả xe
 */
async function emergencyStopAndClear(context) {
    const { pool, logEvent, updateAndBroadcastState, stopSimulation } = context;
    stopSimulation(context); // Gọi hàm stop từ context
    try {
        await pool.execute('DELETE FROM vehicles WHERE 1=1');
        context.activeVehicles = []; // Cập nhật lại mảng
        await logEvent('error', 'Dừng khẩn cấp: Dây chuyền dừng, xe đã xóa.');
        updateAndBroadcastState();
    } catch (error) {
        console.error('Lỗi dừng khẩn cấp:', error);
        await logEvent('error', `Lỗi dừng khẩn cấp: ${error.message}`);
        throw error;
    }
}

/**
 * Xác nhận lỗi (OK - Lỗi nhẹ) tại Offline Repair
 */
async function confirmVehicleError(context, body_id, errorDescription, socket) {
    const { pool, activeVehicles, logEvent, updateAndBroadcastState, io, stationsData } = context;
    const vehicle = activeVehicles.find(v => v && v.body_id === body_id);

    if (vehicle && vehicle.status === 'rework_pending' && vehicle.current_station_id === OFFLINE_REPAIR_ID) {
        try {
            const decision = 'OK (Lỗi nhẹ)';
            const entryTime = vehicle.stationEntryTime ? new Date(vehicle.stationEntryTime) : new Date();
            const [result] = await pool.execute(
                'INSERT INTO error_logs (body_id, station_id, manual_description, start_time, decision) VALUES (?, ?, ?, ?, ?)',
                [body_id, OFFLINE_REPAIR_ID, errorDescription || 'N/A', entryTime, decision]
            );

            // Gửi log mới cho FE
            const newErrorLog = {
                id: result.insertId, body_id,
                timestamp: entryTime.toISOString(),
                error_description: errorDescription || 'N/A',
                decision,
                station_name: stationsData[vehicle.current_station_id]?.name,
                model_name: vehicle.model_name
            };
            if (io) io.emit('new-error-log', newErrorLog);

            vehicle.status = 'ok';
            vehicle.current_error_type_id = null;
            vehicle.current_error_name = null;

            await pool.execute('UPDATE vehicles SET status = ?, current_error_type_id = ? WHERE body_id = ?', ['ok', null, body_id]);

            await logEvent('info', `Xác nhận sửa lỗi "${errorDescription || 'N/A'}" cho xe ${body_id}. Xe sẵn sàng di chuyển.`);
            if (io) io.emit('action-confirmed', { message: `Xe ${body_id} đã sửa xong.`, type: 'success' });
            updateAndBroadcastState();
        } catch (error) {
            console.error(`Lỗi DB khi xác nhận lỗi xe ${body_id}:`, error);
            await logEvent('error', `Lỗi DB khi xác nhận lỗi xe ${body_id}: ${error.message}`);
            if (socket) socket.emit('action-error', { message: `Lỗi CSDL khi xác nhận sửa xe ${body_id}.` });
        }
    } else {
        if (socket) socket.emit('action-error', { message: `Xe ${body_id} không ở trạng thái cần xác nhận.` });
    }
}

/**
 * Gửi xe đi sơn lại (NG) tại Offline Repair
 */
async function sendVehicleToRecoat(context, body_id, errorDescription, socket) {
    const { pool, activeVehicles, logEvent, updateAndBroadcastState, io, stationsData } = context;
    const vehicle = activeVehicles.find(v => v && v.body_id === body_id);

    if (vehicle && vehicle.status === 'rework_pending' && vehicle.current_station_id === OFFLINE_REPAIR_ID) {
        try {
            const decision = 'NG (Sơn lại)';
            const entryTime = vehicle.stationEntryTime ? new Date(vehicle.stationEntryTime) : new Date();
            const [result] = await pool.execute(
                'INSERT INTO error_logs (body_id, station_id, manual_description, start_time, decision) VALUES (?, ?, ?, ?, ?)',
                [body_id, OFFLINE_REPAIR_ID, errorDescription, entryTime, decision]
            );

            // Gửi log mới cho FE
            const newErrorLog = {
                id: result.insertId, body_id,
                timestamp: entryTime.toISOString(),
                error_description: errorDescription,
                decision,
                station_name: stationsData[vehicle.current_station_id]?.name,
                model_name: vehicle.model_name
            };
            if (io) io.emit('new-error-log', newErrorLog);

            vehicle.status = 'rework_offline';
            vehicle.current_error_type_id = null;
            vehicle.current_error_name = null;

            await pool.execute('UPDATE vehicles SET status = ?, current_error_type_id = ? WHERE body_id = ?', ['rework_offline', null, body_id]);

            await logEvent('warning', `Xe ${body_id} [${errorDescription}] không thể sửa, gửi đi sơn lại.`);
            if (io) io.emit('action-confirmed', { message: `Xe ${body_id} đã chuyển đến Wait Recoat.`, type: 'warning' });
            updateAndBroadcastState();
        } catch (error) {
            console.error(`Lỗi DB khi gửi xe ${body_id} đi recoat:`, error);
            await logEvent('error', `Lỗi DB khi gửi xe ${body_id} đi recoat: ${error.message}`);
            if (socket) socket.emit('action-error', { message: `Lỗi CSDL khi gửi xe ${body_id} đi recoat.` });
        }
    } else {
        if (socket) socket.emit('action-error', { message: `Xe ${body_id} không ở trạng thái cần gửi đi WR.` });
    }
}


module.exports = {
    pauseLine,
    playLine,
    addVehicle,
    removeVehicle,
    emergencyStopAndClear,
    confirmVehicleError,
    sendVehicleToRecoat
};