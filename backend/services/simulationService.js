const SIMULATION_TICK_RATE = 1000;

let io;
let pool;
let stationsData = {};
let activeVehicles = [];
let errorTypesData = [];
let simulationIntervalId = null;
let isPausedByUser = false;

// IDs trạm đặc biệt
const OVEN_STATION_IDS = [4, 14];
const inspection_station_id = 10;
const repair_station_id = 23;
const post_repair_destination_id = 12;
const TOPCOAT_INSPECTION_ID = 17;
const OFFLINE_REPAIR_ID = 25;
const FINISHING_ID = 18;
const WAIT_RECOAT_ID = 24;
const CHECKPOINT_STATION_IDS = [1, 12, 17, 19];
 
// Tỷ lệ lỗi ngẫu nhiên
const inspection_failure_rate = 0.1;
const TOPCOAT_FAILURE_RATE = 0.1;
const OFFLINE_REPAIR_SUCCESS_RATE = 0.9;

// Truy vấn SQL lấy thông tin xe bao gồm cả tên lỗi hiện tại (nếu có)
const SELECT_VEHICLES_QUERY = `
    SELECT
        v.*,
        cb.model_name,
        cb.target_color,
        cb.color_hex,
        et.name AS current_error_name
    FROM vehicles v
    JOIN car_bodies cb ON v.body_id = cb.body_id
    LEFT JOIN error_types et ON v.current_error_type_id = et.id
`;

// --- HÀM GHI LOG ---
async function logEvent(type, message) {
    let insertedId = null;
    try {
        const query = 'INSERT INTO logs (type, message) VALUES (?, ?)';
        const [result] = await pool.execute(query, [type, message]);
        insertedId = result.insertId;
    } catch (error) { console.error(`❌ DB Log Error: ${error.message}`); }
    if (insertedId && io) {
        const newLogEntry = { id: insertedId, timestamp: new Date().toISOString(), type: type, message: message };
        io.emit('new-log', newLogEntry);
    }
}

async function simulationTick() {
    const now = Date.now();
    const dbUpdates = [];
    let stateChanged = false;
    // console.log(`--- Tick: ${new Date().toLocaleTimeString()} ---`);

    const vehiclesInBuffer = activeVehicles.filter(v => v.current_station_id === 0).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // FIFO
    if (vehiclesInBuffer.length > 0) {
        const loadingStation = stationsData[1];
        if (loadingStation && loadingStation.capacity > 0) {
            let occupiedSlotsSet = new Set(activeVehicles.filter(v => v.current_station_id === 1).map(v => v.slot_position));
            let bufferIndex = 0;
    
            while (bufferIndex < vehiclesInBuffer.length && occupiedSlotsSet.size < loadingStation.capacity) {
                let targetSlotPosition = -1;

                for (let i = loadingStation.capacity - 1; i >= 0; i--) { if (!occupiedSlotsSet.has(i)) { targetSlotPosition = i; break; } }
                if (targetSlotPosition === -1) break;

                const vehicleToLoad = vehiclesInBuffer[bufferIndex];


                const updateQuery = 'UPDATE vehicles SET current_station_id = ?, slot_position = ?, status = ? WHERE body_id = ?';
                dbUpdates.push({ query: updateQuery, params: [1, targetSlotPosition, 'ok', vehicleToLoad.body_id] });

 
                const vehicleInActiveList = activeVehicles.find(v => v.id === vehicleToLoad.id);
                if (vehicleInActiveList) {
                    vehicleInActiveList.current_station_id = 1; vehicleInActiveList.slot_position = targetSlotPosition;
                    vehicleInActiveList.slotEntryTime = now; vehicleInActiveList.stationEntryTime = now;
                    vehicleInActiveList.status = 'ok';
                } else { console.error(`Lỗi logic buffer: Không tìm thấy ${vehicleToLoad.body_id}`); bufferIndex++; continue; }

                stateChanged = true;
                await logEvent('info', `Xe ${vehicleToLoad.body_id} vào Loading slot ${targetSlotPosition}.`);
                if (CHECKPOINT_STATION_IDS.includes(1) && io) {
                    io.emit('vehicle-checkpoint', {
                        message: `${vehicleInActiveList.body_id} đã vào ${stationsData[1].name} (Trạng thái: OK).`,
                        type: 'success' 
                    });
                }

                occupiedSlotsSet.add(targetSlotPosition);
                bufferIndex++;
            }
        }
    }

    const activeStationIds = [...new Set(activeVehicles.map(v => v.current_station_id))].filter(id => id !== 0);
    for (const stationId of activeStationIds) {
        const currentStation = stationsData[stationId];
        if (!currentStation) continue;

        const vehiclesAtStation = activeVehicles.filter(v => v.current_station_id === stationId).sort((a, b) => b.slot_position - a.slot_position);

        for (const vehicle of vehiclesAtStation) {
            if (['error_stoppage', 'error_logic'].includes(vehicle.status)) continue;

            if (!vehicle.slotEntryTime) { vehicle.slotEntryTime = now; stateChanged = true; }
            if (!vehicle.stationEntryTime) { vehicle.stationEntryTime = vehicle.slotEntryTime; stateChanged = true; }

            if (!currentStation.capacity || currentStation.capacity <= 0) { await logEvent('error', `Lỗi capacity trạm ${currentStation.name}.`); vehicle.status = 'error_logic'; stateChanged = true; continue; }


            let requiredTime = 0, timeElapsed = 0;
            const isOven = OVEN_STATION_IDS.includes(currentStation.id);
            const isLastSlot = vehicle.slot_position === currentStation.capacity - 1;
            const stationTaktTime = currentStation.takt_time || 15000;
            const capacity = currentStation.capacity > 0 ? currentStation.capacity : 1;
            const isSpecialTimeStation = currentStation.id === repair_station_id || currentStation.id === OFFLINE_REPAIR_ID || currentStation.id === WAIT_RECOAT_ID;

            if ((isOven && isLastSlot) || (isSpecialTimeStation && isLastSlot)) {
                 requiredTime = stationTaktTime; timeElapsed = now - (vehicle.stationEntryTime || now);
             } else { 
                 requiredTime = stationTaktTime / capacity; timeElapsed = now - (vehicle.slotEntryTime || now);
             }

            let attemptMove = false;
            if (timeElapsed >= requiredTime) { 
                attemptMove = true;
                if (vehicle.status === 'blocked') { 
                    if (vehicle.status !== 'rework' && vehicle.status !== 'rework_offline') { vehicle.status = 'ok'; }
                    stateChanged = true;
                }
            } else if (vehicle.status === 'blocked') { attemptMove = true; }

            if (!attemptMove) continue;

            if (isLastSlot) {
                let potentialStatus = vehicle.status;
                let potentialErrorTypeId = vehicle.current_error_type_id;

                if (vehicle.current_station_id === inspection_station_id) {
                    if (vehicle.primer_lap_count <= 1 && vehicle.current_error_type_id === null && Math.random() < inspection_failure_rate) {
                        potentialStatus = 'rework';
                        if (errorTypesData.length > 0) { potentialErrorTypeId = errorTypesData[Math.floor(Math.random() * errorTypesData.length)].id; } else { potentialErrorTypeId = null; }
                    } else {
                        if (potentialStatus !== 'rework') {
                            potentialStatus = 'ok';
                            potentialErrorTypeId = null;
                        }
                    }
                    stateChanged = true;
                }
                else if (vehicle.current_station_id === TOPCOAT_INSPECTION_ID) {
                    if (vehicle.current_error_type_id === null && Math.random() < TOPCOAT_FAILURE_RATE) {
                        potentialStatus = 'rework';
                        if (errorTypesData.length > 0) { potentialErrorTypeId = errorTypesData[Math.floor(Math.random() * errorTypesData.length)].id; } else { potentialErrorTypeId = null; }
                    } else { if (potentialStatus !== 'rework') { potentialStatus = 'ok'; potentialErrorTypeId = null; } }
                    stateChanged = true;
                }
                else if (vehicle.current_station_id === repair_station_id) { potentialStatus = 'ok'; potentialErrorTypeId = null; }
                else if (vehicle.current_station_id === OFFLINE_REPAIR_ID) { if (Math.random() < OFFLINE_REPAIR_SUCCESS_RATE) { potentialStatus = 'ok'; potentialErrorTypeId = null; } else { potentialStatus = 'rework_offline'; } stateChanged = true; }
                else if (vehicle.current_station_id === WAIT_RECOAT_ID) { potentialStatus = 'ok'; potentialErrorTypeId = null; }

                const tempVehicleForRouting = { ...vehicle, status: potentialStatus };
                const nextStationId = getNextStationId(tempVehicleForRouting);

                let newLapCount = vehicle.primer_lap_count;

                if (vehicle.current_station_id === 14 && nextStationId === 9) {
                    newLapCount++;
                }

                if (nextStationId === null) { dbUpdates.push({ query: 'DELETE FROM vehicles WHERE body_id = ?', params: [vehicle.body_id], vehicleIdToRemove: vehicle.body_id }); 
                await logEvent('success', `Hoàn thành: ${vehicle.body_id}.`);
                const completeMessage = `Hoàn thành: ${vehicle.body_id}.`;
                    await logEvent('success', completeMessage);
                    if (io) {
                        io.emit('vehicle-completed', { message: completeMessage, type: 'success'});
                    }
                stateChanged = true;
                // console.log(`[DEBUG 22 Exit Queued] Xe ${vehicle.body_id} - Đã thêm lệnh DELETE vào dbUpdates.`);
                continue; }
                const nextStation = stationsData[nextStationId];
                if (!nextStation || !nextStation.capacity || nextStation.capacity <= 0) { await logEvent('error', `Lỗi logic trạm tiếp theo ${nextStationId} cho ${vehicle.body_id}.`); vehicle.status = 'error_logic'; stateChanged = true; continue; }
                const isNextSlotZeroFree = !activeVehicles.some(v => v.current_station_id === nextStationId && v.slot_position === 0);

                if (isNextSlotZeroFree) {
                    const nextSlot = 0;
                    const updateQuery = 'UPDATE vehicles SET current_station_id = ?, slot_position = ?, primer_lap_count = ?, status = ?, current_error_type_id = ? WHERE body_id = ?';
                    const updateParams = [nextStationId, nextSlot, newLapCount, potentialStatus, potentialErrorTypeId, vehicle.body_id];
                    dbUpdates.push({ query: updateQuery, params: updateParams });

                    const oldStatus = vehicle.status; const oldStationId = vehicle.current_station_id;
                    vehicle.current_station_id = nextStationId; vehicle.slot_position = nextSlot;
                    vehicle.slotEntryTime = now; vehicle.stationEntryTime = now; vehicle.primer_lap_count = newLapCount;
                    vehicle.status = potentialStatus; vehicle.current_error_type_id = potentialErrorTypeId;
                    vehicle.current_error_name = errorTypesData.find(et => et.id === potentialErrorTypeId)?.name || null;
                    stateChanged = true;

                    if (CHECKPOINT_STATION_IDS.includes(nextStationId) && nextStationId !== 1 && io) {
                        let checkpointMessage = '';
                        let messageType = 'info';
                        if (vehicle.status === 'rework' || vehicle.status === 'rework_offline') {
                            checkpointMessage = `Xe ${vehicle.current_error_name || 'Không xác định'}`;
                            messageType = 'error';
                        } else {
                            checkpointMessage = `Xe ${vehicle.body_id} đến ${stationsData[nextStationId].name} (Trạng thái: OK).`;
                            messageType = 'success';
                        }

                        io.emit('vehicle-checkpoint', { message: checkpointMessage, type: messageType });
                    }

                    const errorName = vehicle.current_error_name || 'Không xác định';
                    if (oldStationId === inspection_station_id && vehicle.status === 'rework' && oldStatus !== 'rework') {
                        await logEvent('warning', `Xe ${vehicle.body_id} lỗi [${errorName}] (Vòng ${vehicle.primer_lap_count}). Đã chuyển đến PM Repair.`);
                        if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} lỗi [${errorName}] (Vòng ${vehicle.primer_lap_count}). Chuyển đến PM Repair.`, type: 'error' });
                    } else if (oldStationId === TOPCOAT_INSPECTION_ID && vehicle.status === 'rework' && oldStatus !== 'rework') {
                         await logEvent('warning', `Xe ${vehicle.body_id} lỗi [${errorName}]. Đã chuyển đến Offline Repair.`);
                         if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} lỗi [${errorName}]. Chuyển đến Offline Repair.`, type: 'error' });
                    } else if (oldStationId === OFFLINE_REPAIR_ID && vehicle.status === 'rework_offline' && oldStatus !== 'rework_offline') {
                        await logEvent('error', `Xe ${vehicle.body_id} không thể sửa lỗi [${errorName}], đã chuyển đến Wait Recoat.`);
                        if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} không thể sửa lỗi [${errorName}], chuyển đến Wait Recoat.`, type: 'error' });
                    }
                    else if (oldStationId === repair_station_id && vehicle.status === 'ok' && oldStatus !== 'ok') {
                        await logEvent('info', `Xe ${vehicle.body_id} đã hoàn thành PM Repair.`);
                    } else if (oldStationId === OFFLINE_REPAIR_ID && vehicle.status === 'ok' && oldStatus !== 'ok') {
                        await logEvent('info', `Xe ${vehicle.body_id} đã sửa xong tại Offline Repair.`);
                    } else if (oldStationId === WAIT_RECOAT_ID && vehicle.status === 'ok' && oldStatus !== 'ok') {
                         await logEvent('info', `Xe ${vehicle.body_id} đã hoàn thành Wait Recoat.`);
                    }
                    else if (oldStationId === 14 && vehicle.current_station_id === 9 && vehicle.primer_lap_count > 0) {
                        await logEvent('info', `${vehicle.body_id} hoàn thành lượt ${vehicle.primer_lap_count-1}, quay lại Primer Storage (lượt ${vehicle.primer_lap_count}).`);
                    }

                } else {
                    if (vehicle.status !== 'blocked') {
                        if (vehicle.status === 'ok') { vehicle.status = 'blocked'; }
                        stateChanged = true;
                    }
                }

            } else {
                 const nextSlotPosition = vehicle.slot_position + 1;
                 const isNextSlotFree = !activeVehicles.some(v => v.current_station_id === vehicle.current_station_id && v.slot_position === nextSlotPosition);

                 if (isNextSlotFree) {
                     vehicle.slot_position = nextSlotPosition; vehicle.slotEntryTime = now;
                     if (vehicle.status === 'blocked' && vehicle.status !== 'rework' && vehicle.status !== 'rework_offline') { vehicle.status = 'ok'; }
                     stateChanged = true;
                 } else {
                      if (vehicle.status !== 'blocked') {
                           if (vehicle.status === 'ok') { vehicle.status = 'blocked'; } 
                           stateChanged = true;
                      }
                 }
            }
        }
    }

    let vehiclesToDeleteInMemory = [];
    if (dbUpdates.length > 0) {
        let connection;
        let transactionSuccess = false;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            vehiclesToDeleteInMemory = [];

            for (const update of dbUpdates) {

                await connection.execute(update.query, update.params);

                if (update.vehicleIdToRemove) {
                    vehiclesToDeleteInMemory.push(update.vehicleIdToRemove);
                }
            }

            await connection.commit();
            transactionSuccess = true;

            if (vehiclesToDeleteInMemory.length > 0) {
                // console.log("[DEBUG 22 DB Transaction Success] Transaction bao gồm DELETE đã commit.");
            }

        } catch (error) {
            console.error("❌ Lỗi DB Transaction:", error);
            await logEvent('error', `Lỗi DB Transaction: ${error.message}`);
            if (dbUpdates.some(upd => upd.query.startsWith('DELETE'))) {
                // console.error("[DEBUG 22 DB Transaction FAILED] Transaction bao gồm DELETE đã bị rollback!");
            }
            if (connection) {
                try {
                    await connection.rollback();
                    console.log("Transaction rolled back successfully.");
                } catch (rbError) {
                    console.error("Rollback failed:", rbError);
                }
            }
            vehiclesToDeleteInMemory = [];
        } finally {
            if (connection) {
                try {
                    connection.release();
                } catch (rlError) {
                    console.error("Release connection failed:", rlError);
                }
            }
        }

        if (transactionSuccess && vehiclesToDeleteInMemory.length > 0) {
            activeVehicles = activeVehicles.filter(v => !vehiclesToDeleteInMemory.includes(v.body_id));
            stateChanged = true;
            // console.log(`[DEBUG 22 Memory Remove Success] Đã xóa [${vehiclesToDeleteInMemory.join(', ')}] khỏi activeVehicles sau commit.`);
        }
    }

    if (stateChanged) { updateAndBroadcastState(); }
    if (simulationIntervalId) { simulationIntervalId = setTimeout(simulationTick, SIMULATION_TICK_RATE); }
}

async function initialize(socketIoInstance, dbPool) {
    io = socketIoInstance; pool = dbPool;
    try {
        const [stationRows] = await pool.execute('SELECT * FROM stations ORDER BY id ASC'); stationsData = {}; stationRows.forEach(station => { stationsData[station.id] = { ...station, vehicles: [] }; });
        try { const [errorTypeRows] = await pool.execute('SELECT id, name FROM error_types'); errorTypesData = errorTypeRows; console.log(`✅ Service: Đã tải ${errorTypesData.length} loại lỗi.`); } catch (error) { console.error("❌ Lỗi tải error_types:", error); errorTypesData = []; }
        const [vehicleRows] = await pool.execute(SELECT_VEHICLES_QUERY + " ORDER BY v.current_station_id ASC, v.created_at ASC"); activeVehicles = vehicleRows.map(v => ({ ...v, slotEntryTime: Date.now(), stationEntryTime: Date.now() }));
        console.log('✅ Service: Đã tải dữ liệu thành công.'); await logEvent('info', 'Hệ thống đã khởi tạo.');
        updateAndBroadcastState(); startSimulation();
    } catch (error) { console.error("❌ Lỗi khởi tạo:", error); await logEvent('error', `Lỗi khởi tạo: ${error.message}`); }
}

async function addVehicle(body_id) {
    try {
        if (activeVehicles.some(v => v.body_id === body_id)) throw new Error(`Xe "${body_id}" đã có.`);
        const [bodyRows] = await pool.execute('SELECT * FROM car_bodies WHERE body_id = ?', [body_id]); if (bodyRows.length === 0) throw new Error(`Mã thân xe "${body_id}" không tồn tại.`);
        await pool.execute('INSERT INTO vehicles (body_id, current_station_id, slot_position, status, primer_lap_count, current_error_type_id) VALUES (?, ?, ?, ?, ?, ?)', [body_id, 0, 0, 'ok', 0, null]);
        const message = `Thêm xe mới: ${body_id} vào buffer chờ.`; await logEvent('success', message);
        const [newVehicleRows] = await pool.execute(`${SELECT_VEHICLES_QUERY} WHERE v.body_id = ?`, [body_id]);
        if (newVehicleRows.length > 0) { const newVehicleData = { ...newVehicleRows[0], slotEntryTime: Date.now(), stationEntryTime: Date.now(), current_error_name: null }; activeVehicles.push(newVehicleData); }
        updateAndBroadcastState();
    } catch (error) { console.error(`❌ Lỗi thêm xe ${body_id}: ${error.message}`); await logEvent('error', `Lỗi thêm xe ${body_id}: ${error.message}`); throw error; }
}

function startSimulation() { 
    if (isPausedByUser || simulationIntervalId) return; 
    console.log(`▶️ Mô phỏng bắt đầu (tick ${SIMULATION_TICK_RATE}ms).`);
    // logEvent('info', `Mô phỏng bắt đầu (tick ${SIMULATION_TICK_RATE}ms).`);
    simulationIntervalId = setTimeout(simulationTick, SIMULATION_TICK_RATE); }

function stopSimulation() { 
    if (simulationIntervalId) {
        clearTimeout(simulationIntervalId); simulationIntervalId = null;
        console.log('⏹️ Mô phỏng đã dừng.'); 
        // logEvent('info', 'Mô phỏng đã dừng.'); 
    } 
}

async function pauseLine() {
    isPausedByUser = true;
    stopSimulation();
    await logEvent('warning', 'Dây chuyền đã tạm dừng bởi người dùng.');
    io.emit('line-status-update', 'paused'); 
}

async function playLine() {
    isPausedByUser = false;
    startSimulation();
    await logEvent('warning', 'Dây chuyền đã hoạt động trở lại.');
    io.emit('line-status-update', 'running');
}

async function emergencyStopAndClear() {
    stopSimulation();
    isPausedByUser = false;
    const message = 'Dừng khẩn cấp: Dây chuyền dừng, xe đã xóa.';
    console.log(`🔥 ${message}`);
    await logEvent('error', message);
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction(); 
        await connection.execute('SET FOREIGN_KEY_CHECKS = 0;');
        await connection.execute('TRUNCATE TABLE vehicles');
        await connection.execute('SET FOREIGN_KEY_CHECKS = 1;');
        await connection.commit();
        
        activeVehicles = [];
        updateAndBroadcastState();z
        console.log('✅ Đã xóa xe thành công.');
    } catch (error) {
        console.error("❌ Lỗi dừng khẩn cấp:", error);
        await logEvent('error', `Lỗi dừng khẩn cấp: ${error.message}`);
        if(connection) await connection.rollback(); 
    } finally {
        if(connection) connection.release();
        startSimulation();
    }
}

async function removeVehicle(body_id) {
    console.log(`[RemoveVehicle] Yêu cầu xóa xe: ${body_id}`);
    const vehicleIndex = activeVehicles.findIndex(v => v.body_id === body_id);
    if (vehicleIndex === -1) throw new Error(`Xe "${body_id}" không tìm thấy.`);
    const vehicleToRemove = activeVehicles[vehicleIndex]; const stationId = vehicleToRemove.current_station_id;
    const wasRunning = !!simulationIntervalId; if(wasRunning) stopSimulation();
    let connection;
    try {
        connection = await pool.getConnection(); await connection.beginTransaction();
        await connection.execute('DELETE FROM vehicles WHERE body_id = ?', [body_id]);
        activeVehicles.splice(vehicleIndex, 1);
        stateChanged = true;
        if (stationId !== 0) {
            const remainingVehicles = activeVehicles.filter(v => v.current_station_id === stationId).sort((a, b) => a.slot_position - b.slot_position);
            const shiftUpdates = []; let needsDbShiftUpdate = false;
            remainingVehicles.forEach((v, newIndex) => { if (v.slot_position !== newIndex) { shiftUpdates.push(connection.execute('UPDATE vehicles SET slot_position = ? WHERE body_id = ?', [newIndex, v.body_id])); v.slot_position = newIndex; needsDbShiftUpdate = true; } });
            if (needsDbShiftUpdate) { await Promise.all(shiftUpdates); }
        }
        await connection.commit(); console.log(`[RemoveVehicle] Xóa và dịch chuyển xe ${body_id} thành công.`);
        await logEvent('warning', `Xe ${body_id} đã bị xóa khỏi trạm/buffer.`); updateAndBroadcastState();
    } catch (error) { console.error(`❌ REMOVE_VEHICLE_ERROR (${body_id}): ${error.message}`); await logEvent('error', `Lỗi khi xóa xe ${body_id}: ${error.message}`); if(connection) await connection.rollback(); throw error; }
    finally { if(connection) connection.release(); if(wasRunning) startSimulation(); }
}

function reportOperationalError(stationId) {
    const station = stationsData[stationId];
    if (station) {
        const message = `Sự cố máy móc: ${station.name}.`; console.log(`🚨 ${message}`); logEvent('error', message); io.emit('operational-error', { stationName: station.name, message: message });
        stopSimulation();
        activeVehicles.filter(v => v.current_station_id === stationId).forEach(v => { v.status = 'error_stoppage'; }); updateAndBroadcastState();
    }
}

function getNextStationId(vehicle) {
    if (['error_stoppage', 'error_logic'].includes(vehicle.status)) { return vehicle.current_station_id; }
    if (vehicle.current_station_id === 0) { return 0; }

    const currentStationId = vehicle.current_station_id;

    if (currentStationId === repair_station_id) { return post_repair_destination_id; }
    if (currentStationId === inspection_station_id && vehicle.status === 'rework') { return repair_station_id; }
    if (currentStationId === TOPCOAT_INSPECTION_ID && vehicle.status === 'rework') { return OFFLINE_REPAIR_ID; }
    if (currentStationId === OFFLINE_REPAIR_ID) {
        if (vehicle.status === 'ok') { return FINISHING_ID; }
        if (vehicle.status === 'rework_offline') { return WAIT_RECOAT_ID; }
        return currentStationId;
    }
    if (currentStationId === WAIT_RECOAT_ID) { return post_repair_destination_id; }

    if (currentStationId === 14) {
        const destination = vehicle.primer_lap_count < 1 ? 9 : 15;
        return destination;
    }

    const mainFlowPath = {
        1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
        10: 11,
        11: 12, 12: 13, 13: 14, 15: 17,
        17: 18,
        18: 19, 19: 20, 20: 22, 22: null
    };
    return mainFlowPath[currentStationId] !== undefined ? mainFlowPath[currentStationId] : null;
}

function getState() {
    const cleanVehicles = activeVehicles.map(v => {
        const { slotEntryTime, stationEntryTime, timerId, ...vehicleData } = v;
        return vehicleData;
    });
    return {
        stations: Object.values(stationsData),
        vehicles: cleanVehicles
    };
}

function updateAndBroadcastState() {
    const currentState = getState();
    currentState.stations.forEach(station => {
        station.vehicles = currentState.vehicles
            .filter(v => v.current_station_id === station.id)
            .sort((a, b) => a.slot_position - b.slot_position);
     });
    io.emit('state-update', currentState);
}

module.exports = {
    initialize,
    start: startSimulation,
    stop: stopSimulation,
    pauseLine,
    playLine,
    addVehicle,
    getState,
    reportOperationalError,
    emergencyStopAndClear,
    removeVehicle,
};