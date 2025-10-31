// File: services/simulationService/index.js

const { SELECT_VEHICLES_QUERY } = require('./constants');
const { startSimulation, stopSimulation } = require('./core');
const helpers = require('./helpers');
const actions = require('./actions');

// === Trạng thái (State) của Service ===
// Các biến này sẽ được quản lý tập trung tại đây
let io;
let pool;
let stationsData = {};
let activeVehicles = [];
let errorTypesData = [];
let simulationIntervalId = null;
let isPausedForNonOvens = false;

// === Context Object ===
// Tạo một "context" object để truyền state và các hàm cho các module con.
// Điều này giúp tránh việc import/export vòng tròn (circular dependencies).
const context = {
    // Getters để luôn lấy giá trị mới nhất
    get io() { return io; },
    get pool() { return pool; },
    get stationsData() { return stationsData; },
    get activeVehicles() { return activeVehicles; },
    get errorTypesData() { return errorTypesData; },
    get isPausedForNonOvens() { return isPausedForNonOvens; },
    get simulationIntervalId() { return simulationIntervalId; },

    // Setters để cập nhật state từ các module con
    set activeVehicles(value) { activeVehicles = value; },
    set isPausedForNonOvens(value) { isPausedForNonOvens = value; },
    set simulationIntervalId(value) { simulationIntervalId = value; },

    // Gắn các hàm helper vào context
    logEvent: (...args) => helpers.logEvent(context, ...args),
    getState: () => helpers.getState(context),
    updateAndBroadcastState: () => helpers.updateAndBroadcastState(context),
    
    // Gắn các hàm core vào context
    stopSimulation: () => stopSimulation(context)
};

// === Initialize Function ===
// Hàm này chịu trách nhiệm nạp dữ liệu ban đầu và thiết lập state
async function initialize(_io, _pool) {
    io = _io;
    pool = _pool;

    try {
        const [stationsRows] = await pool.query('SELECT * FROM stations');
        stationsData = stationsRows.reduce((acc, station) => { acc[station.id] = station; return acc; }, {});

        const [vehiclesRows] = await pool.query(SELECT_VEHICLES_QUERY);
        activeVehicles = vehiclesRows.map(vehicle => ({
            ...vehicle,
            stationEntryTime: vehicle.dbStationEntryTime ? new Date(vehicle.dbStationEntryTime).getTime() : Date.now(),
            slotEntryTime: vehicle.slotEntryTime ? new Date(vehicle.slotEntryTime).getTime() : Date.now(),
            status: vehicle.status || 'ok'
        }));

        const [errorTypesRows] = await pool.query('SELECT * FROM error_types');
        errorTypesData = errorTypesRows;

        console.log(`Đã tải: ${Object.keys(stationsData).length} trạm, ${activeVehicles.length} xe, ${errorTypesData.length} loại lỗi.`);
        await context.logEvent('info', 'Hệ thống đã khởi tạo thành công.');
        context.updateAndBroadcastState();

    } catch (error) {
        console.error('Lỗi khi tải dữ liệu ban đầu:', error);
        await context.logEvent('error', `Lỗi tải dữ liệu ban đầu: ${error.message}`);
    }
}

// === Public Exports ===
// Xuất ra các hàm public. Các hàm này sẽ tự động gọi hàm bên trong
// với "context" đã được chuẩn bị.
module.exports = {
    initialize,
    start: () => startSimulation(context),
    stop: () => stopSimulation(context),
    pauseLine: () => actions.pauseLine(context),
    playLine: () => actions.playLine(context),
    addVehicle: (body_id) => actions.addVehicle(context, body_id),
    removeVehicle: (body_id) => actions.removeVehicle(context, body_id),
    emergencyStopAndClear: () => actions.emergencyStopAndClear(context),
    getState: () => helpers.getState(context),
    confirmVehicleError: (body_id, desc, socket) => actions.confirmVehicleError(context, body_id, desc, socket),
    sendVehicleToRecoat: (body_id, desc, socket) => actions.sendVehicleToRecoat(context, body_id, desc, socket)
};