// File: services/simulationService/helpers.js

const {
    PM_REPAIR_ID, PREPARE_ID, PM_INSPECTION_ID, TOPCOAT_INSPECTION_ID,
    OFFLINE_REPAIR_ID, FINISHING_ID, WAIT_RECOAT_ID, PRIMER_TC_OVEN_ID,
    PRIMER_STORAGE_ID, TOPCOAT_STORAGE_ID, ED_OBS_ID, A1_OBS_ID, HANGER_AGV_ID
} = require('./constants');

/**
 * Ghi log ra CSDL và broadcast qua Socket.IO
 */
async function logEvent(context, type, message) {
    let insertedId = null;
    try {
        const query = 'INSERT INTO logs (type, message) VALUES (?, ?)';
        const [result] = await context.pool.execute(query, [type, message]);
        insertedId = result.insertId;
    } catch (error) {
        console.error(`DB Log Error: ${error.message}`);
    }

    if (insertedId && context.io) {
        context.io.emit('new-log', { id: insertedId, timestamp: new Date().toISOString(), type, message });
    }
}

/**
 * Lấy bản sao "sạch" của trạng thái hiện tại
 */
function getState(context) {
    const cleanVehicles = JSON.parse(JSON.stringify(context.activeVehicles))
        .map(({ timerId, dbStationEntryTime, ...vehicleData }) => vehicleData);
    const stationsCopy = JSON.parse(JSON.stringify(Object.values(context.stationsData)));
    return { stations: stationsCopy, vehicles: cleanVehicles };
}

/**
 * Gửi trạng thái mới nhất đến tất cả client
 */
function updateAndBroadcastState(context) {
    if (!context.io) {
        console.error("Update State Error: io object is not initialized!");
        return;
    }
    const currentState = getState(context);
    currentState.stations.forEach(station => {
        station.vehicles = currentState.vehicles
            .filter(v => v.current_station_id === station.id)
            .sort((a, b) => a.slot_position - b.slot_position);
    });
    context.io.emit('state-update', currentState);
}

/**
 * Logic định tuyến: Tìm trạm tiếp theo cho một xe
 */
function getNextStationId(vehicle) {
    if (['error_stoppage', 'error_logic'].includes(vehicle.status)) return vehicle.current_station_id;

    const currentStationId = vehicle.current_station_id;

    switch (currentStationId) {
        case PM_REPAIR_ID: return PREPARE_ID;
        case PM_INSPECTION_ID:
            return vehicle.status === 'rework' ? PM_REPAIR_ID : 11;
        case TOPCOAT_INSPECTION_ID:
            return vehicle.status === 'rework_pending' ? OFFLINE_REPAIR_ID : FINISHING_ID;
        case OFFLINE_REPAIR_ID:
            if (vehicle.status === 'ok') return FINISHING_ID;
            if (vehicle.status === 'rework_offline') return WAIT_RECOAT_ID;
            return currentStationId;
        case WAIT_RECOAT_ID: return PREPARE_ID;
        case PRIMER_TC_OVEN_ID:
            return vehicle.primer_lap_count < 1 ? PRIMER_STORAGE_ID : TOPCOAT_STORAGE_ID;
        default:
            const mainFlow = {
                1: 2, 2: 3, 3: 4, 4: ED_OBS_ID, 5: 6, 6: 7, 7: 8, 8: PRIMER_STORAGE_ID,
                9: PM_INSPECTION_ID,
                11: PREPARE_ID,
                12: 13, 13: PRIMER_TC_OVEN_ID,
                15: TOPCOAT_INSPECTION_ID,
                16: TOPCOAT_INSPECTION_ID,
                18: 19, 19: A1_OBS_ID,
                20: HANGER_AGV_ID,
                22: null
            };
            return mainFlow[currentStationId] !== undefined ? mainFlow[currentStationId] : null;
    }
}

/**
 * Di chuyển xe sang trạm tiếp theo và cập nhật CSDL
 */
async function moveVehicleToNextStation(context, vehicle, nextStationId, connection, now, targetSlot = 0) {
    const { stationsData, logEvent } = context;
    const prevStationId = vehicle.current_station_id;
    const prevStation = stationsData[prevStationId];
    
    if (nextStationId !== PM_REPAIR_ID && nextStationId !== OFFLINE_REPAIR_ID && nextStationId !== WAIT_RECOAT_ID) {
         vehicle.status = 'ok';
    }

    vehicle.current_station_id = nextStationId;
    vehicle.slot_position = targetSlot;
    vehicle.stationEntryTime = now;
    vehicle.slotEntryTime = now;

    if (prevStationId === PRIMER_TC_OVEN_ID && nextStationId === PRIMER_STORAGE_ID) {
        vehicle.primer_lap_count += 1;
        await logEvent('info', `Xe ${vehicle.body_id} hoàn thành vòng sơn lót (lần ${vehicle.primer_lap_count}).`);
    }

    await connection.execute(
        'UPDATE vehicles SET current_station_id = ?, slot_position = ?, stationEntryTime = ?, slotEntryTime = ?, status = ?, primer_lap_count = ? WHERE body_id = ?',
        [nextStationId, targetSlot, new Date(now), new Date(now), vehicle.status, vehicle.primer_lap_count, vehicle.body_id]
    );

    const nextStation = stationsData[nextStationId];
    await logEvent('info', `Xe ${vehicle.body_id} di chuyển từ ${prevStation ? prevStation.name : 'Buffer'} vào ${nextStation ? nextStation.name : 'Vị trí mới'} slot ${targetSlot}.`);
}

/**
 * Xóa xe khỏi CSDL khi hoàn thành
 */
async function completeVehicle(context, vehicle, connection) {
    const { logEvent, io } = context;
    await connection.execute('DELETE FROM vehicles WHERE body_id = ?', [vehicle.body_id]);
    await logEvent('success', `Hoàn thành: ${vehicle.body_id}.`);
    if (io) io.emit('vehicle-completed', { message: `Xe ${vehicle.body_id} hoàn thành quy trình sơn!`, type: 'success' });
}


module.exports = {
    logEvent,
    getState,
    updateAndBroadcastState,
    getNextStationId,
    moveVehicleToNextStation,
    completeVehicle
};