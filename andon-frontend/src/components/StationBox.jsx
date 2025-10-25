import React, { useState, useEffect } from 'react';
import '../assets/StationBox.css';

const STATIONS_WITH_DOT = ['Loading', 'Prepare', 'Topcoat Inspection', 'QVG', 'Offline Repair'];
// === BỔ SUNG: ID các trạm đặc biệt ===
const OVEN_STATION_IDS = [4, 14];
const REPAIR_STATION_ID = 23;
// === KẾT THÚC BỔ SUNG ===

// Hook cập nhật liên tục (giữ nguyên)
const useHighFrequencyTimer = () => {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        let animationFrameId;
        const update = () => {
            setNow(Date.now());
            animationFrameId = requestAnimationFrame(update);
        };
        animationFrameId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(animationFrameId);
    }, []);
    return now;
};

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
    const now = useHighFrequencyTimer();

    if (!station) return null;

    // Logic xác định trạng thái (giữ nguyên)
    const getStatus = () => {
        if (!vehicles || vehicles.length === 0) return { color: 'idle', text: 'Empty' };
        if (vehicles.some(v => v.status === 'rework' || v.status === 'rework_offline')) return { color: 'rework', text: 'Rework' };
        if (vehicles.some(v => v.status === 'error_stoppage')) return { color: 'error', text: 'Stop' };
        if (vehicles.some(v => v.status === 'blocked')) return { color: 'blocked', text: 'Blocked' };
        return { color: 'ok', text: 'Active' };
    };

    const stationStatus = getStatus();
    const hasBlinkingDot = STATIONS_WITH_DOT.includes(station.name);

    // === CẬP NHẬT HOÀN CHỈNH LOGIC ĐỒNG HỒ ===
    const calculateRemainingTime = () => {
        if (!vehicles || vehicles.length === 0) {
            return null; // Trả về null để không hiển thị gì
        }
        
        const vehicleToTrack = vehicles.reduce((prev, curr) =>
            (!prev || curr.slot_position > prev.slot_position) ? curr : prev
        , null);

        if (!vehicleToTrack || (!vehicleToTrack.slotEntryTime && !vehicleToTrack.stationEntryTime)) {
             return null;
        }

        const isOven = OVEN_STATION_IDS.includes(station.id);
        const isRepair = station.id === REPAIR_STATION_ID;
        const isLastSlot = vehicleToTrack.slot_position === station.capacity - 1;
        const stationTaktTime = station.takt_time || 15000;
        const capacity = station.capacity > 0 ? station.capacity : 1; // Tránh chia cho 0

        let requiredTimeMs = 0;
        let entryTimeMs = 0;

        // Logic thời gian đặc biệt cho Lò/Repair khi ở slot cuối
        if ((isOven && isLastSlot) || (isRepair && isLastSlot)) {
            requiredTimeMs = stationTaktTime;
            // Ưu tiên stationEntryTime, nếu không có thì dùng slotEntryTime (dự phòng), cuối cùng là now
            entryTimeMs = vehicleToTrack.stationEntryTime || vehicleToTrack.slotEntryTime || now;
        }
        // Logic cho các trạm/slot bình thường
        else {
            requiredTimeMs = stationTaktTime / capacity;
             // Ưu tiên slotEntryTime, nếu không có thì dùng stationEntryTime (dự phòng), cuối cùng là now
            entryTimeMs = vehicleToTrack.slotEntryTime || vehicleToTrack.stationEntryTime || now;
        }

        // Tính thời gian đã trôi qua và thời gian còn lại
        const elapsedMs = now - entryTimeMs;
        const remainingMs = Math.max(0, requiredTimeMs - elapsedMs); // Không hiển thị số âm

        return remainingMs / 1000; // Chuyển sang giây
    };

    const remainingTime = calculateRemainingTime();
    // Xác định xem có nên hiển thị timer không
    const shouldShowTimer = remainingTime !== null;
    // === KẾT THÚC CẬP NHẬT ĐỒNG HỒ ===

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
                    {/* Chỉ hiển thị timer nếu shouldShowTimer là true */}
                    {shouldShowTimer && (
                        <span className="station-timer">
                            {/* Hiển thị thời gian còn lại */}
                            {remainingTime.toFixed(1)}s
                        </span>
                    )}
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
                                    {/* <span className="vehicle-model">{vehicleInSlot.model_name.charAt(0)}</span> */}
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