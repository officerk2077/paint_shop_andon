// File: services/simulationService/handlers.js

const {
    PM_INSPECTION_ID, TOPCOAT_INSPECTION_ID,
    PM_INSPECTION_FAILURE_RATE, TOPCOAT_FAILURE_RATE
} = require('./constants');

/**
 * Xử lý logic kiểm tra lỗi tại trạm PM Inspection
 */
async function handlePMInspection(context, vehicle, connection) {
    const { errorTypesData, logEvent, io } = context;

    if (vehicle.primer_lap_count < 1 && vehicle.current_error_type_id === null &&
        !['rework', 'rework_offline', 'rework_pending'].includes(vehicle.status)) {
        
        if (Math.random() < PM_INSPECTION_FAILURE_RATE) {
            vehicle.status = 'rework';
            const err = errorTypesData.length > 0
                ? errorTypesData[Math.floor(Math.random() * errorTypesData.length)]
                : { id: null, name: 'Không xác định' };
            vehicle.current_error_type_id = err.id;
            vehicle.current_error_name = err.name;

            await connection.execute(
                'UPDATE vehicles SET status = ?, current_error_type_id = ? WHERE body_id = ?',
                [vehicle.status, err.id, vehicle.body_id]
            );

            const entryTime = vehicle.stationEntryTime ? new Date(vehicle.stationEntryTime) : new Date();

            await connection.execute(
                'INSERT INTO error_logs (body_id, station_id, error_type_id, start_time, manual_description, decision) VALUES (?, ?, ?, ?, ?, ?)',
                [vehicle.body_id, PM_INSPECTION_ID, err.id, entryTime, err.name, 'Chuyển PM Repair']
            );

            await logEvent('warning', `Xe ${vehicle.body_id} lỗi [${err.name}]. Đã chuyển đến PM Repair.`);
            if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} lỗi [${err.name}].`, type: 'error' });
            return true;
        }
    }
    return false;
}

/**
 * Xử lý logic kiểm tra lỗi tại trạm Topcoat Inspection
 */
async function handleTopcoatInspection(context, vehicle, connection) {
    const { errorTypesData, logEvent, io } = context;

    if (vehicle.current_error_type_id === null &&
        !['rework_pending', 'rework_offline'].includes(vehicle.status)) {
        
        if (Math.random() < TOPCOAT_FAILURE_RATE) {
            const err = errorTypesData.length > 0
                ? errorTypesData[Math.floor(Math.random() * errorTypesData.length)]
                : { id: null, name: 'Không xác định' };

            vehicle.status = 'rework_pending';
            vehicle.current_error_type_id = null;
            vehicle.current_error_name = null;

            await connection.execute(
                'UPDATE vehicles SET status = ?, current_error_type_id = ? WHERE body_id = ?',
                ['rework_pending', null, vehicle.body_id]
            );

            const entryTime = vehicle.stationEntryTime ? new Date(vehicle.stationEntryTime) : new Date();
            await connection.execute(
                'INSERT INTO error_logs (body_id, station_id, start_time, error_type_id, manual_description, decision) VALUES (?, ?, ?, ?, ?, ?)',
                [vehicle.body_id, TOPCOAT_INSPECTION_ID, entryTime, err.id, err.name, 'Chờ xử lý Offline']
            );

            await logEvent('warning', `Xe ${vehicle.body_id} lỗi tại Topcoat Inspection. Chuyển đến Offline Repair.`);
            if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} lỗi Topcoat.`, type: 'error' });
            return true;
        }
    }
    return false;
}

module.exports = {
    handlePMInspection,
    handleTopcoatInspection
};