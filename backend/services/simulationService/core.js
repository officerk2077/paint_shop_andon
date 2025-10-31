// File: services/simulationService/core.js

const {
    SIMULATION_TICK_RATE, BUFFER_STATION_ID, LOADING_STATION_ID,
    OVEN_STATION_IDS, PAUSE_BYPASS_IDS, PM_INSPECTION_ID,
    TOPCOAT_INSPECTION_ID, OFFLINE_REPAIR_ID, CHECKPOINT_STATION_IDS
} = require('./constants');

const {
    getNextStationId, moveVehicleToNextStation, completeVehicle
} = require('./helpers');

const {
    handlePMInspection, handleTopcoatInspection
} = require('./handlers');

/**
 * Vòng lặp chính của mô phỏng
 */
async function simulationTick(context) {
    let stateChanged = false;
    const {
        pool, activeVehicles, stationsData, isPausedForNonOvens,
        logEvent, updateAndBroadcastState, io
    } = context;

    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const now = Date.now();

            // 1. Logic giải trừ "blocked"
            for (const vehicle of activeVehicles) {
                if (!vehicle) continue;
                if (vehicle.status === 'blocked') {
                    const nextStationId = getNextStationId(vehicle);
                    if (nextStationId !== null) {
                        const vehiclesAtNextStation = activeVehicles.filter(v => v && v.current_station_id === nextStationId);
                        const isNextSlot0Empty = !vehiclesAtNextStation.some(v => v.slot_position === 0);

                        if (isNextSlot0Empty) {
                            vehicle.status = 'ok';
                            await connection.execute('UPDATE vehicles SET status = ? WHERE body_id = ?', ['ok', vehicle.body_id]);
                            stateChanged = true;
                            await logEvent('info', `Xe ${vehicle.body_id} được giải phóng (Block giải trừ) tại ${stationsData[vehicle.current_station_id].name}.`);
                        }
                    }
                }
            }

            // 2. Logic đưa xe từ Buffer vào Loading
            const vehiclesInBuffer = activeVehicles
                .filter(v => v && v.current_station_id === BUFFER_STATION_ID)
                .sort((a, b) => a.slotEntryTime - b.slotEntryTime);

            if (stationsData[LOADING_STATION_ID] && vehiclesInBuffer.length > 0) {
                const vehiclesAtLoading = activeVehicles.filter(v => v && v.current_station_id === LOADING_STATION_ID);
                let isSlot0Empty = !vehiclesAtLoading.some(v => v.slot_position === 0);
                let isSlot1Empty = !vehiclesAtLoading.some(v => v.slot_position === 1);
                const carsToLoad = vehiclesInBuffer.slice(0, 2);

                for (const vehicle of carsToLoad) {
                    let targetSlot = isSlot1Empty ? 1 : (isSlot0Empty ? 0 : -1);
                    if (targetSlot === -1) break;

                    await moveVehicleToNextStation(context, vehicle, LOADING_STATION_ID, connection, now, targetSlot);
                    if (targetSlot === 0) isSlot0Empty = false;
                    if (targetSlot === 1) isSlot1Empty = false;
                    stateChanged = true;
                }
            }

            // 3. Logic di chuyển xe trong dây chuyền
            for (let i = activeVehicles.length - 1; i >= 0; i--) {
                const vehicle = activeVehicles[i];
                if (!vehicle) continue;

                try {
                    const station = stationsData[vehicle.current_station_id];
                    const prevStationId = vehicle.current_station_id;

                    if (!station || vehicle.status === 'blocked' || vehicle.status === 'error_stoppage') continue;

                    const shouldBypassPause = OVEN_STATION_IDS.includes(station.id) || PAUSE_BYPASS_IDS.includes(station.id);
                    if (isPausedForNonOvens && !shouldBypassPause) continue;

                    const { takt_time: stationTaktTime, capacity } = station;
                    const elapsedSlotTime = now - (vehicle.slotEntryTime || now);
                    const elapsedStationTime = now - (vehicle.stationEntryTime || now);

                    // Logic nghiệp vụ đặc biệt (kiểm tra lỗi)
                    let handled = false;
                    if (vehicle.current_station_id === PM_INSPECTION_ID) {
                        handled = await handlePMInspection(context, vehicle, connection);
                    } else if (vehicle.current_station_id === TOPCOAT_INSPECTION_ID) {
                        handled = await handleTopcoatInspection(context, vehicle, connection);
                    }
                    if (handled) {
                        stateChanged = true;
                        continue;
                    }

                    // Logic dồn xe trong trạm
                    if (elapsedSlotTime >= (stationTaktTime / capacity)) {
                         if (vehicle.current_station_id !== LOADING_STATION_ID) {
                            const nextSlot = vehicle.slot_position + 1;
                            if (nextSlot < capacity) {
                                const isNextSlotEmpty = !activeVehicles.some(v =>
                                    v && v.current_station_id === station.id && v.slot_position === nextSlot
                                );
                                if (isNextSlotEmpty) {
                                    vehicle.slot_position = nextSlot;
                                    vehicle.slotEntryTime = now;
                                    await connection.execute('UPDATE vehicles SET slot_position = ? WHERE body_id = ?', [nextSlot, vehicle.body_id]);
                                    stateChanged = true;
                                }
                            }
                        }
                    }

                    // Logic di chuyển ra khỏi trạm
                    const isFirstToMoveOut = (station.id === LOADING_STATION_ID) ? 
                        (vehicle.slot_position === 1) : 
                        (vehicle.slot_position === capacity - 1);
                    
                    if (isFirstToMoveOut && elapsedStationTime >= stationTaktTime) {
                        if (station.id === OFFLINE_REPAIR_ID && vehicle.status === 'rework_pending') continue;

                        const nextStationId = getNextStationId(vehicle);
                        if (nextStationId === null) {
                            await completeVehicle(context, vehicle, connection);
                            activeVehicles.splice(i, 1);
                            stateChanged = true;
                            continue;
                        }

                        const nextStation = stationsData[nextStationId];
                        const nextStationVehicles = activeVehicles.filter(v => v && v.current_station_id === nextStationId);

                        if (!nextStation) {
                            vehicle.status = 'error_logic';
                            await logEvent('error', `Lỗi logic: Không tìm thấy trạm ${nextStationId} cho xe ${vehicle.body_id}.`);
                            continue;
                        }
                        
                        const isNextSlotEmpty = !nextStationVehicles.some(v => v.slot_position === 0);
                        const isNextStationBypass = OVEN_STATION_IDS.includes(nextStationId) || PAUSE_BYPASS_IDS.includes(nextStationId);
                        
                        if (isPausedForNonOvens && !isNextStationBypass) {
                             vehicle.status = 'blocked';
                             stateChanged = true;
                             continue; 
                        }

                        if (isNextSlotEmpty) {
                            await moveVehicleToNextStation(context, vehicle, nextStationId, connection, now);
                            stateChanged = true;

                            if (CHECKPOINT_STATION_IDS.includes(nextStationId)) {
                                io.emit('vehicle-checkpoint', {
                                    message: `Xe ${vehicle.body_id} đã đến checkpoint ${nextStation.name}.`,
                                    type: 'info'
                                });
                            }

                            // Logic dồn xe tại Loading khi xe slot 1 rời đi
                            if (prevStationId === LOADING_STATION_ID) {
                                const shiftVehicle = activeVehicles.find(v => v && v.current_station_id === LOADING_STATION_ID && v.slot_position === 0);
                                if (shiftVehicle) {
                                    shiftVehicle.slot_position = 1;
                                    shiftVehicle.slotEntryTime = now;
                                    await connection.execute(
                                        'UPDATE vehicles SET slot_position = ?, slotEntryTime = ? WHERE body_id = ?',
                                        [1, new Date(now), shiftVehicle.body_id]
                                    );
                                    await logEvent('info', `Xe ${shiftVehicle.body_id} dồn chỗ từ slot 0 sang 1 tại Loading.`);
                                }
                            }
                        } else {
                            vehicle.status = 'blocked';
                            stateChanged = true;
                        }
                    }
                } catch (error) {
                    const vehicleId = vehicle ? vehicle.body_id : 'ID_KHÔNG_XÁC_ĐỊNH';
                    console.error(`Lỗi nghiêm trọng khi xử lý xe ${vehicleId}:`, error);
                    await logEvent('error', `Lỗi nghiêm trọng khi xử lý xe ${vehicleId}: ${error.message}`);
                    throw error;
                }
            }

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            console.error('Lỗi trong transaction simulationTick:', error);
            await logEvent('error', `Lỗi trong transaction simulationTick: ${error.message}`);
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi kết nối DB trong simulationTick:', error);
        await logEvent('error', `Lỗi kết nối DB trong simulationTick: ${error.message}`);
    }

    if (stateChanged) updateAndBroadcastState();
}

/**
 * Bắt đầu/dừng mô phỏng
 */
function startSimulation(context) {
    if (context.simulationIntervalId) return;
    // Truyền context vào hàm tick
    context.simulationIntervalId = setInterval(() => simulationTick(context), SIMULATION_TICK_RATE);
    console.log('Bắt đầu mô phỏng.');
    context.logEvent('info', 'Mô phỏng bắt đầu.');
}

function stopSimulation(context) {
    if (context.simulationIntervalId) {
        clearInterval(context.simulationIntervalId);
        context.simulationIntervalId = null;
        console.log('🛑 Dừng mô phỏng.');
        context.logEvent('info', 'Mô phỏng đã dừng.');
    }
}

module.exports = {
    simulationTick,
    startSimulation,
    stopSimulation
};