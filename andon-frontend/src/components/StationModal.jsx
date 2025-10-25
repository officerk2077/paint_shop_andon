
import React from 'react';
import { FaTrashAlt } from 'react-icons/fa';
import '../assets/StationModal.css';

// Thêm `onRemoveVehicle` vào danh sách props
const StationModal = ({ station, vehicles, onClose, onRemoveVehicle }) => {
    if (!station) return null;

    const handleContentClick = (e) => e.stopPropagation();

    // const handleReportErrorClick = () => {
    //     onReportError(station.id);
    // };

    // --- HÀM MỚI: Xử lý khi nhấn nút xóa xe ---
    const handleRemoveClick = (bodyId, modelName) => {
        // Hỏi xác nhận trước khi xóa
        if (window.confirm(`Bạn có chắc chắn muốn xóa xe ${bodyId} (${modelName}) khỏi dây chuyền không?`)) {
            // Kiểm tra xem prop có phải là hàm không trước khi gọi
            if (typeof onRemoveVehicle === 'function') {
                onRemoveVehicle(bodyId);
            } else {
                console.error("Lỗi: onRemoveVehicle không phải là một hàm!");
            }
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={handleContentClick}>
                <button className="close-button" onClick={onClose}>×</button>
                
                <h2>Thông tin trạm: {station.name}</h2>

                <div className="modal-details">
                    <p><strong>Trạng thái:</strong> {vehicles.length > 0 ? "Đang hoạt động" : "Trống"}</p>
                    <p><strong>Sức chứa:</strong> {station.capacity}</p>
                    <p><strong>Số xe hiện tại:</strong> {vehicles ? vehicles.length : 0}</p>
                </div>

                <div className="vehicle-list">
                    <h4>Danh sách xe tại trạm:</h4>
                    {vehicles && vehicles.length > 0 ? (
                        <ul>
                            {vehicles.sort((a, b) => a.slot_position - b.slot_position).map(v => (
                                <li key={v.body_id}>
                                    <span className="vehicle-details">
                                        <span className="slot-indicator">[Slot {v.slot_position}]</span> 
                                        <span className="color-swatch" style={{ backgroundColor: v.color_hex }}></span>
                                        {v.body_id} - {v.model_name} ({v.target_color})
                                        - <span className={`status-text-${v.status}`}>{v.status}</span>

                                        {v.current_error_name && (
                                            <span className="error-details">
                                                : {v.current_error_name}
                                            </span>
                                        )}
                                        {/* === KẾT THÚC BỔ SUNG === */}

                                    </span>
                                    <button 
                                        className="remove-vehicle-btn" 
                                        onClick={() => handleRemoveClick(v.body_id, v.model_name)}
                                        title={`Xóa xe ${v.body_id}`}
                                    >
                                        <FaTrashAlt />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>Không có xe nào tại trạm.</p>
                    )}
                </div>

                {/* <div className="modal-actions">
                    <button className="action-button error-button" onClick={handleReportErrorClick}>
                        Báo lỗi máy móc
                    </button>
                </div> */}
            </div>
        </div>
    );
};

export default StationModal;