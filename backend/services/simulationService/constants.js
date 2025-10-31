// File: services/simulationService/constants.js

module.exports = {
    SIMULATION_TICK_RATE: 1000,

    // === IDs Trạm Đặc Biệt ===
    BUFFER_STATION_ID: 0,
    LOADING_STATION_ID: 1,
    ED_OBS_ID: 5,
    OVEN_STATION_IDS: [4, 14],
    PM_INSPECTION_ID: 10,
    PM_REPAIR_ID: 23,
    PREPARE_ID: 12,
    TOPCOAT_INSPECTION_ID: 17,
    OFFLINE_REPAIR_ID: 25,
    PAUSE_BYPASS_IDS: [5, 25, 9, 15], // ED_OBS, OFFLINE_REPAIR, PRIMER_STORAGE, TOPCOAT_STORAGE
    FINISHING_ID: 18,
    WAIT_RECOAT_ID: 24,
    CHECKPOINT_STATION_IDS: [1, 12, 17, 19],
    PRIMER_STORAGE_ID: 9,
    PRIMER_TC_OVEN_ID: 14,
    TOPCOAT_STORAGE_ID: 15,
    BUFFER_MASKING_ID: 16,
    A1_OBS_ID: 20,
    HANGER_AGV_ID: 22,

    // === Tỷ lệ lỗi ===
    PM_INSPECTION_FAILURE_RATE: 0.1,
    TOPCOAT_FAILURE_RATE: 0.1,

    // === Query ===
    SELECT_VEHICLES_QUERY: `
        SELECT
            v.*, v.stationEntryTime as dbStationEntryTime,
            cb.model_name, cb.target_color, cb.color_hex,
            et.name AS current_error_name
        FROM vehicles v
        JOIN car_bodies cb ON v.body_id = cb.body_id
        LEFT JOIN error_types et ON v.current_error_type_id = et.id
    `
};