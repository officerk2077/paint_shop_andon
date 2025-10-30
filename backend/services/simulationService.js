
const SIMULATION_TICK_RATE = 1000; // Tốc độ mô phỏng (ms)

// Biến cục bộ
let io; // Sẽ được gán trong hàm initialize
let pool;
let stationsData = {};
let activeVehicles = [];
let errorTypesData = [];
let simulationIntervalId = null;
// Cờ chính cho logic tạm dừng mới (chỉ dừng các trạm không phải lò)
let isPausedForNonOvens = false;

// === IDs Trạm Đặc Biệt ===
const BUFFER_STATION_ID = 0;        // Buffer ảo
const LOADING_STATION_ID = 1;       // Loading (trạm đầu tiên)
const ED_OBS_ID = 5;
const OVEN_STATION_IDS = [4, 14]; 
const PM_INSPECTION_ID = 10;
const PM_REPAIR_ID = 23;
const PREPARE_ID = 12;
const TOPCOAT_INSPECTION_ID = 17;
const OFFLINE_REPAIR_ID = 25;

const PAUSE_BYPASS_IDS = [ED_OBS_ID, OFFLINE_REPAIR_ID, 9, 15]; 


const FINISHING_ID = 18;
const WAIT_RECOAT_ID = 24;
const CHECKPOINT_STATION_IDS = [1, 12, 17, 19];
const PRIMER_STORAGE_ID = 9;
const PRIMER_TC_OVEN_ID = 14;
const TOPCOAT_STORAGE_ID = 15;
const BUFFER_MASKING_ID = 16;
const A1_OBS_ID = 20;
const HANGER_AGV_ID = 22;

const PM_INSPECTION_FAILURE_RATE = 0.1; // 10%
const TOPCOAT_FAILURE_RATE = 0.1; // Tỷ lệ lỗi Topcoat

// === Truy Vấn SQL ===
const SELECT_VEHICLES_QUERY = `
    SELECT
        v.*, v.stationEntryTime as dbStationEntryTime,
        cb.model_name, cb.target_color, cb.color_hex,
        et.name AS current_error_name
    FROM vehicles v
    JOIN car_bodies cb ON v.body_id = cb.body_id
    LEFT JOIN error_types et ON v.current_error_type_id = et.id
`;

// ======================================
// === HÀM TIỆN ÍCH ===
// ======================================

async function logEvent(type, message) {
    let insertedId = null;
    try {
        const query = 'INSERT INTO logs (type, message) VALUES (?, ?)';
        const [result] = await pool.execute(query, [type, message]);
        insertedId = result.insertId;
    } catch (error) { 
        console.error(`DB Log Error: ${error.message}`); 
    }

    if (insertedId && io) {
        io.emit('new-log', { id: insertedId, timestamp: new Date().toISOString(), type, message });
    }
}

function getState() {
    // Đảm bảo chỉ gửi dữ liệu cần thiết qua Socket.IO
    const cleanVehicles = JSON.parse(JSON.stringify(activeVehicles))
        .map(({ timerId, dbStationEntryTime, ...vehicleData }) => vehicleData);
    const stationsCopy = JSON.parse(JSON.stringify(Object.values(stationsData)));
    return { stations: stationsCopy, vehicles: cleanVehicles };
}

function updateAndBroadcastState() {
    if (!io) {
        console.error("Update State Error: io object is not initialized!");
        return;
    }
    const currentState = getState();
    currentState.stations.forEach(station => {
        station.vehicles = currentState.vehicles
            .filter(v => v.current_station_id === station.id)
            .sort((a, b) => a.slot_position - b.slot_position);
    });
    io.emit('state-update', currentState);
}

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
            // Sửa logic: Khi rework_pending, nó KHÔNG nên trả về currentStationId (gây lặp)
            // Nó chỉ nên di chuyển khi status là 'ok' hoặc 'rework_offline'
            if (vehicle.status === 'ok') return FINISHING_ID;
            if (vehicle.status === 'rework_offline') return WAIT_RECOAT_ID;
            return currentStationId; // Giữ nguyên nếu là rework_pending (nhưng sẽ bị chặn bởi logic tick)
        case WAIT_RECOAT_ID: return PREPARE_ID;
        case PRIMER_TC_OVEN_ID:
            // *** LOGIC RẼ NHÁNH ***
            // Kiểm tra primer_lap_count (vẫn là 0 ở lần đầu tiên).
            // Nếu < 1 (là 0), quay lại Trạm 9.
            // Nếu >= 1 (là 1), đi tiếp Trạm 15.
            return vehicle.primer_lap_count < 1 ? PRIMER_STORAGE_ID : TOPCOAT_STORAGE_ID;
        default:
            const mainFlow = {
                1: 2, 2: 3, 3: 4, 4: ED_OBS_ID, 5: 6, 6: 7, 7: 8, 8: PRIMER_STORAGE_ID,
                9: PM_INSPECTION_ID,
                11: PREPARE_ID,
                12: 13, 13: PRIMER_TC_OVEN_ID,
                
                // *** BỎ QUA TRẠM 16 ***
                15: TOPCOAT_INSPECTION_ID, // (15) Topcoat Storage -> (17) Topcoat Inspection
                16: TOPCOAT_INSPECTION_ID, 
                // *** KẾT THÚC BỎ QUA ***

                18: 19, 19: A1_OBS_ID,
                20: HANGER_AGV_ID,
                22: null
            };
            return mainFlow[currentStationId] !== undefined ? mainFlow[currentStationId] : null;
    }
}

// ======================================
// === KHỞI TẠO ===
// ======================================

async function initialize(_io, _pool) {
    io = _io;
    pool = _pool;
    if (!pool) { console.error("Initialization Error: pool is not provided!"); return; }

    try {
        const [stationsRows] = await pool.query('SELECT * FROM stations');
        stationsData = stationsRows.reduce((acc, station) => { acc[station.id] = station; return acc; }, {});

        const [vehiclesRows] = await pool.query(SELECT_VEHICLES_QUERY);
        activeVehicles = vehiclesRows.map(vehicle => ({
            ...vehicle,
            stationEntryTime: vehicle.dbStationEntryTime ? new Date(vehicle.dbStationEntryTime).getTime() : Date.now(),
            slotEntryTime: vehicle.slotEntryTime ? new Date(vehicle.slotEntryTime).getTime() : Date.now(), // Lấy từ DB
            status: vehicle.status || 'ok'
        }));

        const [errorTypesRows] = await pool.query('SELECT * FROM error_types');
        errorTypesData = errorTypesRows;

        console.log(`Đã tải: ${Object.keys(stationsData).length} trạm, ${activeVehicles.length} xe, ${errorTypesData.length} loại lỗi.`);
        await logEvent('info', 'Hệ thống đã khởi tạo thành công.');
        updateAndBroadcastState();

    } catch (error) {
        console.error('Lỗi khi tải dữ liệu ban đầu:', error);
        await logEvent('error', `Lỗi tải dữ liệu ban đầu: ${error.message}`);
    }
}

// ======================================
// === MÔ PHỎNG CHÍNH ===
// ======================================

function startSimulation() {
    if (simulationIntervalId) return;
    simulationIntervalId = setInterval(simulationTick, SIMULATION_TICK_RATE);
    console.log('Bắt đầu mô phỏng.');
    logEvent('info', 'Mô phỏng bắt đầu (tick 1000ms).');
}

/**
 * @description Dừng vòng lặp mô phỏng chính. Khắc phục lỗi ReferenceError.
 */
function stopSimulation() { 
    if (simulationIntervalId) {
        clearInterval(simulationIntervalId);
        simulationIntervalId = null;
        console.log('🛑 Dừng mô phỏng.');
        logEvent('info', 'Mô phỏng đã dừng.');
    }
}


async function simulationTick() {
    let stateChanged = false;

    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const now = Date.now();
            
            // ======================================
            // === XỬ LÝ GIẢI PHÓNG XE BỊ BLOCKED (Bỏ chặn) - KHẮC PHỤC LỖI KẸT DÙ TRẠM ĐÍCH TRỐNG ===
            // ======================================
            for (const vehicle of activeVehicles) {
                if (vehicle.status === 'blocked') {
                    const nextStationId = getNextStationId(vehicle);
                    if (nextStationId !== null) {
                        const vehiclesAtNextStation = activeVehicles.filter(v => v.current_station_id === nextStationId);
                        const isNextSlot0Empty = !vehiclesAtNextStation.some(v => v.slot_position === 0);

                        if (isNextSlot0Empty) {
                            // Giải phóng xe
                            vehicle.status = 'ok';
                            // Cập nhật vào DB
                            await connection.execute('UPDATE vehicles SET status = ? WHERE body_id = ?', ['ok', vehicle.body_id]);
                            stateChanged = true;
                            await logEvent('info', `Xe ${vehicle.body_id} được giải phóng (Block giải trừ) tại ${stationsData[vehicle.current_station_id].name}.`);
                        }
                    }
                }
            }
            // ======================================
            // === KẾT THÚC XỬ LÝ GIẢI PHÓNG XE BỊ BLOCKED ===
            // ======================================


            // === XỬ LÝ XE TRONG BUFFER ẢO (current_station_id = 0) - NẠP XE TỪ PHẢI (SLOT CAO NHẤT) ===
            
            const vehiclesInBuffer = activeVehicles
                .filter(v => v.current_station_id === BUFFER_STATION_ID)
                .sort((a, b) => a.slotEntryTime - b.slotEntryTime); // FIFO: Cũ nhất lên đầu (Xe 01, Xe 02,...)

            const loadingStation = stationsData[LOADING_STATION_ID];

            if (loadingStation && vehiclesInBuffer.length > 0) {
                const vehiclesAtLoading = activeVehicles.filter(v => v.current_station_id === LOADING_STATION_ID);
                
                // Giả định Loading có Capacity 2 (Slot 0 và Slot 1)
                let isSlot0Empty = !vehiclesAtLoading.some(v => v.slot_position === 0);
                let isSlot1Empty = !vehiclesAtLoading.some(v => v.slot_position === 1);
                
                const carsToLoad = vehiclesInBuffer.slice(0, 2); // Chỉ xem xét 2 xe FIFO
                
                // Duyệt qua 2 xe FIFO, ưu tiên nạp vào slot cao nhất (Slot 1)
                for (const vehicle of carsToLoad) {
                    let targetSlot = -1;
                    
                    // Ưu tiên nạp vào Slot 1 (bên phải, slot cao nhất)
                    if (isSlot1Empty) {
                        targetSlot = 1;
                    } 
                    // Sau đó mới nạp vào Slot 0 (bên trái, slot thấp nhất)
                    else if (isSlot0Empty) {
                        targetSlot = 0;
                    }
                    
                    if (targetSlot === -1) {
                        break; // Không còn slot trống trong Loading
                    }

                    // Di chuyển xe
                    await moveVehicleToNextStation(vehicle, LOADING_STATION_ID, connection, now, targetSlot);
                    
                    // Cập nhật trạng thái slot trống sau khi di chuyển
                    if (targetSlot === 0) isSlot0Empty = false;
                    if (targetSlot === 1) isSlot1Empty = false;
                    stateChanged = true;
                }
            }
            // === KẾT THÚC XỬ LÝ BUFFER ẢO ===


            // === VÒNG LẶP CHÍNH: XỬ LÝ XE TRONG CÁC TRẠM THỰC ===
            for (let i = activeVehicles.length - 1; i >= 0; i--) {
                const vehicle = activeVehicles[i];
                // Thêm try...catch bên trong để xử lý lỗi cục bộ (khắc phục ReferenceError: i is not defined)
                try {
                    const station = stationsData[vehicle.current_station_id];
                    const prevStationId = vehicle.current_station_id;

                    // Bỏ qua nếu xe đang bị chặn, dừng khẩn cấp, hoặc dây chuyền đang tạm dừng
                    if (!station || vehicle.status === 'blocked' || vehicle.status === 'error_stoppage') continue;
                    
                    // *** LOGIC TẠM DỪNG MỚI (BAO GỒM ED OBS) ***
                    const shouldBypassPause = OVEN_STATION_IDS.includes(vehicle.current_station_id) || PAUSE_BYPASS_IDS.includes(vehicle.current_station_id);
                    
                    if (isPausedForNonOvens && !shouldBypassPause) continue;
                    // *** KẾT THÚC LOGIC TẠM DỪNG MỚI ***

                    const entryTime = vehicle.stationEntryTime || now;
                    const slotEntryTime = vehicle.slotEntryTime || now;
                    const stationTaktTime = station.takt_time;
                    const capacity = station.capacity;

                    // *** LOGIC XÁC ĐỊNH XE ĐẦU TIÊN CẦN RỜI TRẠM ***
                    // Tại Loading (ID 1), xe ở Slot 1 đi trước. Ở các trạm khác, Slot cuối cùng (capacity - 1) đi trước.
                    const isFirstToMoveOut = (
                        vehicle.current_station_id === LOADING_STATION_ID ? 
                        vehicle.slot_position === 1 : 
                        vehicle.slot_position === capacity - 1
                    );

                    const requiredTime = isFirstToMoveOut ? stationTaktTime : stationTaktTime / capacity;

                    const elapsedSlotTime = now - slotEntryTime;
                    const elapsedStationTime = now - entryTime;
                    // *** KẾT THÚC LOGIC XÁC ĐỊNH XE ĐẦU TIÊN ***
                    
                    let handled = false;
                    if (vehicle.current_station_id === PM_INSPECTION_ID) {
                        handled = await handlePMInspection(vehicle, connection);
                        if (handled) stateChanged = true;
                    } else if (vehicle.current_station_id === TOPCOAT_INSPECTION_ID) {
                        handled = await handleTopcoatInspection(vehicle, connection);
                        if (handled) stateChanged = true;
                    }

                    if (handled) continue;

                    // PHASE 2A: Xử lý xe ở vị trí di chuyển ra (Slot 1 cho Loading, Slot cuối cho các trạm khác)
                    if (isFirstToMoveOut && elapsedStationTime >= requiredTime) {
                        
                        // *** SỬA LỖI: ĐÓNG BĂNG XE TẠI SLOT CUỐI OFFLINE REPAIR ***
                        if (vehicle.current_station_id === OFFLINE_REPAIR_ID && vehicle.status === 'rework_pending') {
                            continue; // Đóng băng tại slot cuối, chờ lệnh (OK/NG)
                        }
                        // *** KẾT THÚC SỬA LỖI ĐÓNG BĂNG ***
                        
                        const nextStationId = getNextStationId(vehicle);
                        let isVehicleMovingOut = false; // Cờ theo dõi xe có rời đi không

                        if (nextStationId === null) {
                            await completeVehicle(vehicle, connection);
                            activeVehicles.splice(i, 1);
                            stateChanged = true;
                            isVehicleMovingOut = true; // Xe hoàn thành (rời đi)
                            continue;
                        }

                        const nextStation = stationsData[nextStationId];
                        const nextStationVehicles = activeVehicles.filter(v => v.current_station_id === nextStationId);
                        
                        if (!nextStation) {
                            // Xử lý lỗi logic khi không tìm thấy trạm tiếp theo
                            vehicle.status = 'error_logic';
                            await logEvent('error', `Lỗi logic: Không tìm thấy trạm ${nextStationId} cho xe ${vehicle.body_id}.`);
                            continue;
                        }

                        const isNextSlotEmpty = !nextStationVehicles.some(v => v.slot_position === 0);

                        // *** LOGIC CHẶN LỐI RA TRẠM BYPASS/OVEN KHI DÂY CHUYỀN DỪNG ***
                        const isNextStationBypass = OVEN_STATION_IDS.includes(nextStationId) || PAUSE_BYPASS_IDS.includes(nextStationId);
                        
                        if (isPausedForNonOvens && !isNextStationBypass) {
                             // Nếu dây chuyền đang dừng VÀ trạm đích KHÔNG phải là trạm bypass (VD: ED Inspection)
                             vehicle.status = 'blocked';
                             stateChanged = true;
                             continue; // Ngăn không cho logic di chuyển bên dưới chạy
                        }
                        // *** KẾT THÚC LOGIC CHẶN LỐI RA ***
                        
                        // Logic di chuyển (chỉ chạy khi không bị chặn bởi PAUSE hoặc bị chiếm slot)
                        if (isNextSlotEmpty) {
                            // Di chuyển xe ra khỏi trạm hiện tại
                            await moveVehicleToNextStation(vehicle, nextStationId, connection, now);
                            // KHÔNG CÓ splice(i, 1) ở đây. Xe vẫn là active, chỉ cần update vị trí
                            stateChanged = true;
                            isVehicleMovingOut = true; // Xe di chuyển (rời đi)

                            if (CHECKPOINT_STATION_IDS.includes(nextStationId)) {
                                io.emit('vehicle-checkpoint', { 
                                    message: `Xe ${vehicle.body_id} đã đến checkpoint ${nextStation.name}.`, 
                                    type: 'info' 
                                });
                            }
                        } else {
                            vehicle.status = 'blocked';
                            stateChanged = true;
                        }

                        // *** LOGIC DỒN CHỖ CHO TRẠM LOADING (DỒN VỀ PHẢI) ***
                        // Áp dụng dồn chỗ khi xe vừa di chuyển ra (isVehicleMovingOut) VÀ trạm trước đó là Loading
                        if (isVehicleMovingOut && prevStationId === LOADING_STATION_ID) {
                            const loadingVehicles = activeVehicles
                                .filter(v => v.current_station_id === LOADING_STATION_ID)
                                .sort((a, b) => a.slot_position - b.slot_position); // Slot nhỏ nhất lên đầu (Slot 0)

                            // Tìm xe ở Slot 0 cần dồn lên Slot 1
                            const shiftVehicle = loadingVehicles.find(v => v.slot_position === 0);
                            
                            if (shiftVehicle) { 
                                const newSlot = 1; // Dồn từ 0 lên 1 (phải)
                                
                                // Bỏ qua nếu Slot 1 đã có xe
                                const isSlot1Occupied = activeVehicles.some(v => 
                                    v.current_station_id === LOADING_STATION_ID && 
                                    v.slot_position === newSlot
                                );

                                if (!isSlot1Occupied) {
                                    // Cập nhật vị trí và thời gian vào slot mới
                                    shiftVehicle.slot_position = newSlot; 
                                    shiftVehicle.slotEntryTime = now;
                                    
                                    await connection.execute(
                                        'UPDATE vehicles SET slot_position = ?, slotEntryTime = ? WHERE body_id = ?', 
                                        [newSlot, new Date(now), shiftVehicle.body_id]
                                    );
                                    await logEvent('info', `Xe ${shiftVehicle.body_id} dồn chỗ từ slot 0 sang slot 1 (phải) tại Loading.`);
                                    stateChanged = true;
                                }
                            }
                        }
                        // *** KẾT THÚC LOGIC DỒN CHỖ ***

                    } else if (elapsedSlotTime >= (stationTaktTime / capacity)) {
                        // PHASE 2B: Logic di chuyển slot nội bộ (chỉ áp dụng cho các trạm KHÔNG phải Loading)
                        if (vehicle.current_station_id !== LOADING_STATION_ID) {
                             const nextSlot = vehicle.slot_position + 1;
                            if (nextSlot < capacity) {
                                const isNextSlotEmpty = !activeVehicles.some(v => 
                                    v.current_station_id === vehicle.current_station_id && v.slot_position === nextSlot
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
                } catch (error) {
                    console.error(`Lỗi nghiêm trọng khi xử lý xe ${vehicle.body_id}:`, error);
                    await logEvent('error', `Lỗi nghiêm trọng khi xử lý xe ${vehicle.body_id}: ${error.message}`);
                    // Re-throw để kích hoạt rollback transaction
                    throw error;
                }
            }
            // === KẾT THÚC VÒNG LẶP CHÍNH ===

            await connection.commit();
        } catch (error) {
            // Lỗi xảy ra bên trong transaction (ví dụ: lỗi DB, hoặc lỗi re-throw từ vòng lặp)
            await connection.rollback();
            console.error('Lỗi trong transaction simulationTick:', error);
            await logEvent('error', `Lỗi trong transaction simulationTick: ${error.message}`);
        } finally {
            connection.release();
        }
    } catch (error) {
        // Lỗi không lấy được connection DB
        console.error('Lỗi kết nối DB trong simulationTick:', error);
        await logEvent('error', `Lỗi kết nối DB trong simulationTick: ${error.message}`);
    }

    if (stateChanged) updateAndBroadcastState();
}

// ======================================
// === XỬ LÝ TRẠM KIỂM TRA ===
// ======================================

async function handlePMInspection(vehicle, connection) {
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
                'INSERT INTO error_logs (body_id, station_id, error_type_id, start_time) VALUES (?, ?, ?, ?)',
                [vehicle.body_id, PM_INSPECTION_ID, err.id, entryTime]
            );

            await logEvent('warning', `Xe ${vehicle.body_id} lỗi [${err.name}] (Vòng ${vehicle.primer_lap_count}). Đã chuyển đến PM Repair.`);
            if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} lỗi [${err.name}].`, type: 'error' });
            return true;
        }
    }
    return false;
}

async function handleTopcoatInspection(vehicle, connection) {
    if (vehicle.current_error_type_id === null && 
        !['rework_pending', 'rework_offline'].includes(vehicle.status)) {
        if (Math.random() < TOPCOAT_FAILURE_RATE) {
            // Lấy ID lỗi ngẫu nhiên để lưu vào log (nhưng không cập nhật vào vehicle.current_error_type_id)
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
                'INSERT INTO error_logs (body_id, station_id, start_time, error_type_id) VALUES (?, ?, ?, ?)',
                [vehicle.body_id, TOPCOAT_INSPECTION_ID, entryTime, err.id]
                // Gắn err.id vào error_logs để có thông tin về loại lỗi ban đầu
            );

            await logEvent('warning', `Xe ${vehicle.body_id} lỗi tại Topcoat Inspection. Chuyển đến Offline Repair.`);
            if (io) io.emit('vehicle-rework-alert', { message: `Xe ${vehicle.body_id} lỗi Topcoat.`, type: 'error' });
            return true;
        }
    }
    return false;
}

// ======================================
// === DI CHUYỂN & HOÀN THÀNH ===
// ======================================

async function moveVehicleToNextStation(vehicle, nextStationId, connection, now, targetSlot = 0) {
    const prevStationId = vehicle.current_station_id;
    const prevStation = stationsData[prevStationId];
    
    // *** SỬA LỖI HIỂN THỊ MÀU VÀNG ***
    // Chỉ reset status về 'ok' nếu trạm tiếp theo KHÔNG phải là trạm repair
    // Trạng thái 'rework' hoặc 'rework_pending' sẽ được giữ nguyên khi di chuyển vào trạm Repair.
    if (nextStationId !== PM_REPAIR_ID && nextStationId !== OFFLINE_REPAIR_ID && nextStationId !== WAIT_RECOAT_ID) {
         vehicle.status = 'ok';
    }
    // *** KẾT THÚC SỬA LỖI ***

    vehicle.current_station_id = nextStationId;
    vehicle.slot_position = targetSlot;
    vehicle.stationEntryTime = now;
    vehicle.slotEntryTime = now;
    // vehicle.status = 'ok'; // <-- DÒNG GỐC BỊ XÓA

    // *******************************************************************
    // === LOGIC MỚI: SỬA LỖI ĐẾM VÒNG LẶP PRIMER ===
    //
    // Xóa logic cũ:
    // if (nextStationId === PRIMER_TC_OVEN_ID) {
    //     vehicle.primer_lap_count += 1;
    // }
    //
    // Thêm logic mới:
    // Chỉ tăng biến đếm KHI xe đi từ Lò (14) quay lại Kho (9).
    // Logic `getNextStationId` sẽ kiểm tra (count=0) và gửi đến 9.
    // Hàm này (moveVehicle) sẽ tăng count lên 1.
    // Lần sau, `getNextStationId` kiểm tra (count=1) và gửi đến 15.
    
    if (prevStationId === PRIMER_TC_OVEN_ID && nextStationId === PRIMER_STORAGE_ID) {
        vehicle.primer_lap_count += 1;
        await logEvent('info', `Xe ${vehicle.body_id} hoàn thành vòng sơn lót, quay lại Primer Storage (lần ${vehicle.primer_lap_count}).`);
    }
    // *******************************************************************

    await connection.execute(
        'UPDATE vehicles SET current_station_id = ?, slot_position = ?, stationEntryTime = ?, slotEntryTime = ?, status = ?, primer_lap_count = ? WHERE body_id = ?',
        // Dùng vehicle.status (đã được cập nhật ở trên) thay vì 'ok'
        [nextStationId, targetSlot, new Date(now), new Date(now), vehicle.status, vehicle.primer_lap_count, vehicle.body_id]
    );

    // Ghi log chi tiết việc di chuyển
    const nextStation = stationsData[nextStationId];
    await logEvent('info', `Xe ${vehicle.body_id} di chuyển từ ${prevStation ? prevStation.name : 'Buffer'} vào ${nextStation ? nextStation.name : 'Vị trí mới'} slot ${targetSlot}.`);
}

async function completeVehicle(vehicle, connection) {
    await connection.execute('DELETE FROM vehicles WHERE body_id = ?', [vehicle.body_id]);
    await logEvent('success', `Hoàn thành: ${vehicle.body_id}.`);
    if (io) io.emit('vehicle-completed', { message: `Xe ${vehicle.body_id} hoàn thành quy trình sơn!`, type: 'success' });
}

// ======================================
// === TẠM DỪNG / TIẾP TỤC ===
// ======================================

async function pauseLine() {
    isPausedForNonOvens = true;
    console.log('Dây chuyền tạm dừng (trừ lò sấy).');
    await logEvent('warning', 'Dây chuyền đã tạm dừng (trừ lò sấy).');
    if (io) io.emit('line-status-update', 'paused');
}

async function playLine() {
    isPausedForNonOvens = false;
    console.log('Dây chuyền tiếp tục.');
    await logEvent('info', 'Dây chuyền đã hoạt động trở lại.');
    if (io) io.emit('line-status-update', 'running');
}

// ======================================
// === THÊM / XÓA XE ===
// ======================================

async function addVehicle(body_id) {
    if (!body_id) throw new Error('Mã thân xe (body_id) là bắt buộc.');

    // Kiểm tra xe có tồn tại trong DB không
    const [bodyRows] = await pool.query('SELECT * FROM car_bodies WHERE body_id = ?', [body_id]);
    if (bodyRows.length === 0) {
        await logEvent('error', `Lỗi thêm xe ${body_id}: Mã thân xe "${body_id}" không tồn tại trong hệ thống.`);
        throw new Error(`Mã thân xe "${body_id}" không tồn tại trong hệ thống.`);
    }

    // Kiểm tra xe có đang hoạt động trong dây chuyền không
    if (activeVehicles.some(v => v.body_id === body_id)) {
        await logEvent('error', `Lỗi thêm xe ${body_id}: Xe "${body_id}" đã có trong dây chuyền.`);
        throw new Error(`Xe "${body_id}" đã có trong dây chuyền.`);
    }

    try {
        const now = Date.now();
        // CẬP NHẬT: Thêm cột slotEntryTime vào câu lệnh INSERT (Sau khi bạn đã ALTER TABLE)
        const [result] = await pool.execute(
            'INSERT INTO vehicles (body_id, current_station_id, status, primer_lap_count, slot_position, stationEntryTime, slotEntryTime) VALUES (?, ?, "ok", 0, 0, ?, ?)',
            [body_id, BUFFER_STATION_ID, new Date(now), new Date(now)]
        );

        // Đọc lại thông tin chi tiết của xe vừa thêm (cần JOIN)
        const [newVehicleRows] = await pool.query(SELECT_VEHICLES_QUERY + ' WHERE v.id = ?', [result.insertId]);
        const newVehicle = newVehicleRows[0];

        activeVehicles.push({
            ...newVehicle,
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

async function removeVehicle(body_id) {
    const index = activeVehicles.findIndex(v => v.body_id === body_id);
    if (index === -1) {
        throw new Error(`Xe ${body_id} không có trong dây chuyền hoặc buffer.`);
    }

    const vehicleToRemove = activeVehicles[index];
    
    try {
        await pool.execute('DELETE FROM vehicles WHERE body_id = ?', [body_id]);
        activeVehicles.splice(index, 1);
        await logEvent('warning', `Xe ${body_id} đã bị xóa khỏi trạm/buffer.`);
        if (io) io.emit('action-confirmed', { message: `Xe ${body_id} đã bị xóa thành công.`, type: 'info' });
        updateAndBroadcastState();
    } catch (error) {
        console.error(`Lỗi DB khi xóa xe ${body_id}:`, error);
        await logEvent('error', `Lỗi DB khi xóa xe ${body_id}: ${error.message}`);
        throw new Error(`Không thể xóa xe khỏi CSDL. ${error.message}`);
    }
}

async function emergencyStopAndClear() {
    stopSimulation();
    try {
        await pool.execute('DELETE FROM vehicles WHERE 1=1');
        activeVehicles = [];
        await logEvent('error', 'Dừng khẩn cấp: Dây chuyền dừng, xe đã xóa.');
        updateAndBroadcastState();
    } catch (error) {
        console.error('Lỗi dừng khẩn cấp:', error);
        await logEvent('error', `Lỗi dừng khẩn cấp: ${error.message}`);
        throw error;
    }
}


// ======================================
// === XỬ LÝ REWORK OFFLINE ===
// ======================================

async function confirmVehicleError(body_id, errorDescription, socket) {
    const vehicle = activeVehicles.find(v => v.body_id === body_id);
    if (vehicle && vehicle.status === 'rework_pending' && vehicle.current_station_id === OFFLINE_REPAIR_ID) {
        const entryTime = vehicle.stationEntryTime ? new Date(vehicle.stationEntryTime) : new Date();
        try {
            await pool.execute(
                'INSERT INTO error_logs (body_id, station_id, manual_description, start_time) VALUES (?, ?, ?, ?)',
                [body_id, OFFLINE_REPAIR_ID, errorDescription || 'N/A', entryTime]
            );
            vehicle.status = 'ok';
            vehicle.current_error_type_id = null;
            vehicle.current_error_name = null;

            await pool.execute(
                'UPDATE vehicles SET status = ?, current_error_type_id = ? WHERE body_id = ?',
                ['ok', null, body_id]
            );

            await logEvent('info', `Xác nhận sửa lỗi "${errorDescription || 'N/A'}" cho xe ${body_id} tại Offline Repair. Xe sẵn sàng di chuyển.`);
            if (io) io.emit('action-confirmed', { message: `Xe ${body_id} đã sửa xong.`, type: 'success' });
            updateAndBroadcastState();
        } catch (error) {
            console.error(`Lỗi DB khi xác nhận lỗi xe ${body_id}:`, error);
            await logEvent('error', `Lỗi DB khi xác nhận lỗi xe ${body_id}: ${error.message}`);
            if (socket) socket.emit('action-error', { message: `Không thể xác nhận sửa xe ${body_id} do lỗi CSDL.` });
        }
    } else {
        if (socket) socket.emit('action-error', { message: `Xe ${body_id} không ở trạng thái cần xác nhận.` });
    }
}

async function sendVehicleToRecoat(body_id, errorDescription, socket) {
    const vehicle = activeVehicles.find(v => v.body_id === body_id);
    if (vehicle && vehicle.status === 'rework_pending' && vehicle.current_station_id === OFFLINE_REPAIR_ID) {
        const entryTime = vehicle.stationEntryTime ? new Date(vehicle.stationEntryTime) : new Date();
        try {
            // Cập nhật error_logs với mô tả thủ công và thời gian kết thúc lỗi ban đầu (trước khi gửi đi recoat)
            await pool.execute(
                'INSERT INTO error_logs (body_id, station_id, manual_description, start_time) VALUES (?, ?, ?, ?)',
                [body_id, OFFLINE_REPAIR_ID, errorDescription, entryTime]
            );

            vehicle.status = 'rework_offline';
            vehicle.current_error_type_id = null;
            vehicle.current_error_name = null;

            await pool.execute(
                'UPDATE vehicles SET status = ?, current_error_type_id = ? WHERE body_id = ?',
                ['rework_offline', null, body_id]
            );

            await logEvent('warning', `Xe ${body_id} [${errorDescription}] không thể sửa, gửi đi sơn lại (Wait Recoat).`);
            if (io) io.emit('action-confirmed', { message: `Xe ${body_id} đã được chuyển đến Wait Recoat.`, type: 'warning' });
            updateAndBroadcastState();
        } catch (error) {
            console.error(`Lỗi DB khi gửi xe ${body_id} đi Wait Recoat:`, error);
            await logEvent('error', `Lỗi DB khi gửi xe ${body_id} đi recoat: ${error.message}`);
            if (socket) socket.emit('action-error', { message: `Không thể gửi xe ${body_id} đi Wait Recoat do lỗi CSDL.` });
        }
    } else {
        if (socket) socket.emit('action-error', { message: `Xe ${body_id} không ở trạng thái cần gửi đi WR.` });
    }
}

// ======================================
// === BÁO LỖI VẬN HÀNH ===
// ======================================

function reportOperationalError(stationId) {
    const station = stationsData[stationId];
    if (station) {
        const message = `Sự cố máy móc tại trạm: ${station.name}.`;
        console.log(`${message}`);
        logEvent('error', message);
        if (io) io.emit('operational-error', { stationName: station.name, message });

        pauseLine();

        activeVehicles
            .filter(v => v.current_station_id === stationId)
            .forEach(v => {
                v.status = 'error_stoppage';
                pool.execute('UPDATE vehicles SET status = ? WHERE body_id = ?', ['error_stoppage', v.body_id])
                    .catch(err => console.error(`Lỗi cập nhật DB cho error_stoppage xe ${v.body_id}:`, err));
            });
        updateAndBroadcastState();
    } else {
        console.error(`[ReportError] Không tìm thấy trạm với ID: ${stationId}`);
    }
}

// ======================================
// === EXPORT MODULE ===
// ======================================
module.exports = {
    initialize,
    start: startSimulation,
    stop: stopSimulation,
    pauseLine,
    playLine,
    addVehicle,
    removeVehicle, // Thêm hàm removeVehicle
    emergencyStopAndClear, // Thêm hàm emergencyStopAndClear
    getState,
    reportOperationalError,
    confirmVehicleError,
    sendVehicleToRecoat
};