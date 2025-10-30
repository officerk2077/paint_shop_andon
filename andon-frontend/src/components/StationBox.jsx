import React from 'react';
import '../assets/StationBox.css';

const STATIONS_WITH_DOT = ['Loading', 'Prepare', 'Topcoat Inspection', 'QVG', 'Offline Repair'];
// === BỔ SUNG: ID các trạm đặc biệt cho Logic hiển thị màu Vàng ===
const OVEN_STATION_IDS = [4, 14];
const PM_REPAIR_ID = 23;
const OFFLINE_REPAIR_ID = 25;
const WAIT_RECOAT_ID = 24;
const PM_INSPECTION_ID = 10;
// Danh sách các trạm được coi là "Repair Stations"
const REPAIR_STATION_IDS = [PM_REPAIR_ID, OFFLINE_REPAIR_ID, WAIT_RECOAT_ID]; 
// === KẾT THÚC BỔ SUNG ===

// Hàm tiện ích xác định màu chữ (giữ nguyên)
const getContrastTextColor = (hexColor) => {
    if (!hexColor || hexColor === 'transparent' || hexColor === '#f8f9fa') return '#212529';
    let r = 0, g = 0, b = 0;
    if (hexColor.length === 7) { r = parseInt(hexColor.substring(1, 3), 16); g = parseInt(hexColor.substring(3, 5), 16); b = parseInt(hexColor.substring(5, 7), 16); }
    else if (hexColor.length === 4) { r = parseInt(hexColor[1] + hexColor[1], 16); g = parseInt(hexColor[2] + hexColor[2], 16); b = parseInt(hexColor[3] + hexColor[3], 16); }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#212529' : '#FFFFFF';
};


const StationBox = ({ station, vehicles, onClick }) => {

    if (!station) return null;

    // Hàm logic xác định trạng thái màu sắc
    const getStatus = () => {
        if (!vehicles || vehicles.length === 0) return { color: 'idle', text: 'Empty' };
        
        // 1. Ưu tiên các lỗi dừng chuyền nghiêm trọng
        if (vehicles.some(v => v.status === 'error_stoppage')) return { color: 'error', text: 'Stop' };
        
        // 2. Kiểm tra trạng thái Rework/Repair
        const isRepairRelatedStation = REPAIR_STATION_IDS.includes(station.id);
        const hasReworkStatus = vehicles.some(v => ['rework', 'rework_pending', 'rework_offline'].includes(v.status));

        if (isRepairRelatedStation && hasReworkStatus) {
            // PM Repair, Offline Repair, Wait Recoat: Hiển thị màu vàng khi có xe lỗi
            return { color: 'rework', text: 'Rework Pending' };
        }

        // 3. Kiểm tra Blocked
        if (vehicles.some(v => v.status === 'blocked')) return { color: 'blocked', text: 'Blocked' };

        // 4. Mặc định là OK (Active) cho các trạm flow bình thường (bao gồm P/M Inspection)
        return { color: 'ok', text: 'Active' };
    };

    const stationStatus = getStatus();
    const hasBlinkingDot = STATIONS_WITH_DOT.includes(station.name);

    return (
        <div
            className={`station-box status-${stationStatus.color}`}
            onClick={onClick}
        >
            <div className="station-header">
                <div className="station-title-container">
                    <span className="station-name">{station.name}</span>
                    {hasBlinkingDot && <div className="blinking-dot"></div>}
                </div>
                 <div className="header-right-group">
                     {/* Không hiển thị gì ở đây */}
                 </div>
            </div>

            <div className="station-body">
                {Array.from({ length: station.capacity }).map((_, slotIndex) => {
                    const vehicleInSlot = vehicles.find(v => v.slot_position === slotIndex);

                    const slotStyle = vehicleInSlot ? { backgroundColor: vehicleInSlot.color_hex, border: '1px solid rgba(0,0,0,0.2)' } : {};
                    const textColor = getContrastTextColor(vehicleInSlot?.color_hex);

                    return (
                        <div key={slotIndex} className="vehicle-slot" style={slotStyle}>
                            {vehicleInSlot && (
                                <div className="vehicle-tag" style={{ color: textColor }}>
                                    <span className="vehicle-id">{vehicleInSlot.body_id}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default StationBox;