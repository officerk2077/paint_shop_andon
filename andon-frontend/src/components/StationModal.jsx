// File: StationModal.jsx
// NỘI DUNG CẬP NHẬT HOÀN CHỈNH (Đã gộp nút)

import React from 'react';
// (Đã xóa 'FaTimes' khỏi import)
import { FaCheck, FaSync, FaTrashAlt } from 'react-icons/fa';
import '../assets/StationModal.css';

const OFFLINE_REPAIR_STATION_ID = 25; // ID trạm Offline Repair

const StationModal = ({ station, vehicles, onClose, onRemoveVehicle, onConfirmError, onSendToRecoat }) => {

    if (!station) return null;

    const handleContentClick = (e) => e.stopPropagation();

    const handleRemoveClick = (bodyId, modelName) => {
        if (window.confirm(`Bạn có chắc chắn muốn xóa xe ${bodyId} (${modelName}) khỏi dây chuyền không?`)) {
            if (typeof onRemoveVehicle === 'function') {
                onRemoveVehicle(bodyId);
                onClose(); 
            } else {
                console.error("Lỗi: onRemoveVehicle không phải là một hàm!");
            }
        }
    };

    const handleConfirmErrorClick = (bodyId) => {
        const description = window.prompt(`Xác nhận sửa xong xe ${bodyId}. Nhập mô tả lỗi nhẹ (nếu có):`, "");
        if (description !== null) {
            onConfirmError(bodyId, description);
            onClose(); 
        }
    };

    const handleSendToRecoatClick = (bodyId) => {
        let description = "";
        let valid = false;

        while (!valid) {
            description = window.prompt(`Xác nhận gửi xe ${bodyId} đi SƠN LẠI. Vui lòng nhập MÔ TẢ LỖI (Bắt buộc):`);
            if (description === null) {
                return; 
            }
            if (description.trim() === "") {
                window.alert("Mô tả lỗi không được để trống khi gửi đi sơn lại.");
            } else {
                valid = true;
            }
        }
        onSendToRecoat(bodyId, description);
        onClose(); 
    };


    return (
        <div className='modal-overlay' onClick={onClose}>
            <div className='modal-content' onClick={handleContentClick}>
                
                {/* Nút Close (X) giữ nguyên style animation */}
                <button className='close-button' onClick={onClose} title="Đóng">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                </button>

                <h2>{station.name}</h2>
                <div className='station-info'>
                    <p>ID: {station.id}</p>
                    <p>Sức chứa: {station.capacity}</p>
                    <p>Thời gian (Takt): {station.takt_time / 1000}s</p>
                </div>
                
                <div className='vehicle-list-container'>
                    <h3>Danh sách xe</h3>
                    {vehicles && vehicles.length > 0 ? (
                        <ul className='vehicle-list'>
                            {vehicles.map(v => (
                                <li key={v.body_id} className={`vehicle-list-item status-${v.status}`}>
                                    <div className='vehicle-info'>
                                        <span className='vehicle-id'>{v.body_id} (Slot {v.slot_position})</span>
                                        <span className='vehicle-model'>Model: {v.model_name || 'N/A'}</span>
                                        <span className='vehicle-color'>Màu: {v.target_color || 'N/A'}</span>
                                        {v.current_error_name && (
                                            <span className='vehicle-error'>Lỗi: {v.current_error_name}</span>
                                        )}
                                    </div>

                                    {/* === BẮT ĐẦU SỬA: Gộp tất cả nút vào một div === */}
                                    <div className='vehicle-actions'>
                                        
                                        {/* Nút xử lý lỗi (chỉ hiện khi cần) */}
                                        {station.id === OFFLINE_REPAIR_STATION_ID && v.status === 'rework_pending' && (
                                            <div className='rework-actions'> {/* Div này để giữ 2 nút OK/NG với nhau */}
                                                <button
                                                    className='action-button confirm-error-btn'
                                                    onClick={() => handleConfirmErrorClick(v.body_id)}
                                                    title={`Xác nhận sửa xong (lỗi nhẹ)`}
                                                >
                                                    <FaCheck /> OK (Sửa xong)
                                                </button>
                                                <button
                                                    className='action-button send-recoat-btn'
                                                    onClick={() => handleSendToRecoatClick(v.body_id)}
                                                    title={`Gửi đi sơn lại (lỗi nặng)`}
                                                >
                                                    <FaSync /> NG (Sơn lại)
                                                </button>
                                            </div>
                                        )}

                                        {/* Nút xóa xe (luôn hiện, nằm chung hàng) */}
                                        <button
                                            className="action-button remove-vehicle-btn"
                                            onClick={() => handleRemoveClick(v.body_id, v.model_name)}
                                            title={`Xóa xe ${v.body_id}`}
                                        >
                                            <FaTrashAlt />
                                        </button>
                                    </div>
                                    {/* === KẾT THÚC SỬA === */}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>Không có xe nào tại trạm.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StationModal;