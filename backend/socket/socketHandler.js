// Hàm này sẽ được gọi từ server.js
function initializeSocket(io, simulationService, getDbStatus) {

    io.on('connection', (socket) => {
        console.log(`🔌 Một người dùng đã kết nối: ${socket.id}`);

        // Gửi trạng thái ban đầu khi kết nối
        socket.emit('initial-state', simulationService.getState());
        socket.emit('db-status-update', getDbStatus());

        socket.on('add-vehicle', async (bodyId) => {
            if (!bodyId) return;
            try {
                await simulationService.addVehicle(bodyId);
            } catch (error) {
                socket.emit('add-vehicle-error', { message: `Không thể thêm xe ${bodyId}. ${error.message}` });
            }
        });

        socket.on('emergency-stop', async () => {
            if (simulationService.emergencyStopAndClear) {
                await simulationService.emergencyStopAndClear();
                simulationService.start(); 
                
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
            } catch (error) {
                console.error(`[Socket] Lỗi khi xóa xe ${bodyId}:`, error);
                socket.emit('action-error', { message: `Không thể xóa xe ${bodyId}. ${error.message}` });
            }
        });

        socket.on('confirm-vehicle-error', async (payload) => {
            if (!payload || !payload.bodyId) {
                console.error('[Socket] Nhận yêu cầu xác nhận lỗi xe không hợp lệ:', payload);
                socket.emit('action-error', { message: 'Dữ liệu yêu cầu không hợp lệ.' });
                return;
            }
            console.log(`[Socket] Nhận yêu cầu xác nhận lỗi xe: ${payload.bodyId} với lỗi "${payload.errorDescription}"`);
            if (simulationService.confirmVehicleError) {
                await simulationService.confirmVehicleError(payload.bodyId, payload.errorDescription, socket);
            }
        });

        socket.on('send-to-recoat', async (payload) => {
            if (!payload || !payload.bodyId) {
                console.error('[Socket] Nhận yêu cầu gửi xe đi WR không hợp lệ:', payload);
                socket.emit('action-error', { message: 'Dữ liệu yêu cầu không hợp lệ.' });
                return;
            }
            console.log(`[socket] Nhận yêu cầu gửi xe đi WR: ${payload.bodyId} với lỗi "${payload.errorDescription}"`);
            if (simulationService.sendVehicleToRecoat) {
                await simulationService.sendVehicleToRecoat(payload.bodyId, payload.errorDescription, socket);
            }
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Người dùng đã ngắt kết nối: ${socket.id}`);
        });

    });
}

module.exports = initializeSocket;