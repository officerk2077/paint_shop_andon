// File: src/components/StationBox.jsx
// NỘI DUNG CẬP NHẬT HOÀN CHỈNH (Sửa lỗi áp dụng màu chữ)

import React from 'react';
import '../assets/StationBox.css';

// === KHU VỰC 1: HÀM TÍNH TOÁN MÀU CHỮ (Giữ nguyên) ===
const getContrastTextColor = (hexColor) => {
  if (!hexColor || hexColor === 'transparent' || hexColor === '#f8f9fa')
    return '#212529'; // Màu chữ đen (mặc định)
  
  let r = 0, g = 0, b = 0;
  
  if (hexColor.length === 7) {
    r = parseInt(hexColor.substring(1, 3), 16);
    g = parseInt(hexColor.substring(3, 5), 16);
    b = parseInt(hexColor.substring(5, 7), 16);
  } else if (hexColor.length === 4) { 
    r = parseInt(hexColor[1] + hexColor[1], 16);
    g = parseInt(hexColor[2] + hexColor[2], 16);
    b = parseInt(hexColor[3] + hexColor[3], 16);
  }
  
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Nền tối (như #000080) sẽ có luminance <= 0.5 -> trả về #FFFFFF (Trắng)
  return luminance > 0.5 ? '#212529' : '#FFFFFF';
};
// === KẾT THÚC KHU VỰC 1 ===

// (Giữ nguyên các hằng số khác)
const STATIONS_WITH_DOT = [
  'Loading', 'Prepare', 'Topcoat Inspection', 'QVG', 'Offline Repair',
];
const OVEN_STATION_IDS = [4, 14];
const PM_REPAIR_ID = 23;
const OFFLINE_REPAIR_ID = 25;
const WAIT_RECOAT_ID = 24;
const PM_INSPECTION_ID = 10;
const REPAIR_STATION_IDS = [PM_REPAIR_ID, OFFLINE_REPAIR_ID, WAIT_RECOAT_ID];
const ROUTE_INDICATOR_STATIONS = [12, 13, 14, 15]; 

const StationBox = ({ station, vehicles, onClick }) => {
  if (!station) return null;

  const getStatus = () => {
    // ... (Hàm getStatus giữ nguyên)
    if (!vehicles || vehicles.length === 0) return { color: 'idle', text: 'Empty' };
    if (vehicles.some((v) => v.status === 'error_stoppage'))
      return { color: 'error', text: 'Stop' };
    const isRepairRelatedStation = REPAIR_STATION_IDS.includes(station.id);
    const hasReworkStatus = vehicles.some((v) =>
      ['rework', 'rework_pending', 'rework_offline'].includes(v.status)
    );
    if (isRepairRelatedStation && hasReworkStatus) {
      return { color: 'rework', text: 'Rework Pending' };
    }
    if (vehicles.some((v) => v.status === 'blocked'))
      return { color: 'blocked', text: 'Blocked' };
    return { color: 'ok', text: 'Active' };
  };

  const stationStatus = getStatus();
  const hasBlinkingDot = STATIONS_WITH_DOT.includes(station.name);

  return (
    <div className={`station-box status-${stationStatus.color}`} onClick={onClick}>
      <div className="station-header">
        <div className="station-title-container">
          <span className="station-name">{station.name}</span>
          {hasBlinkingDot && <div className="blinking-dot"></div>}
        </div>
        <div className="header-right-group"></div>
      </div>

      <div className="station-body">
        {Array.from({ length: station.capacity }).map((_, slotIndex) => {
          const vehicleInSlot = vehicles.find((v) => v.slot_position === slotIndex);
          const slotStyle = vehicleInSlot
            ? { backgroundColor: vehicleInSlot.color_hex, border: '1px solid rgba(0,0,0,0.2)' }
            : {};
          
          const textColor = getContrastTextColor(vehicleInSlot?.color_hex);

          return (
            <div key={slotIndex} className="vehicle-slot" style={slotStyle}>
              {vehicleInSlot && (
                
                // === SỬA LỖI: ÁP DỤNG STYLE VÀO SPAN THAY VÌ DIV ===
                <div className="vehicle-tag">
                  {/* Style 'color: textColor' đã được chuyển vào đây */}
                  <span className="vehicle-id" style={{ color: textColor }}>
                    {vehicleInSlot.body_id}
                  </span>
                {/* === KẾT THÚC SỬA LỖI === */}

                  {/* (Phần code dấu chấm giữ nguyên) */}
                  {ROUTE_INDICATOR_STATIONS.includes(station.id) && (
                    <span
                      className="route-indicator-dot"
                      title={
                        (vehicleInSlot.primer_lap_count || 0) >= 1
                          ? 'Đi Topcoat Storage'
                          : 'Đi Primer Storage'
                      }
                      style={{
                        backgroundColor: (vehicleInSlot.primer_lap_count || 0) >= 1 ? '#ff0000ff' : '#FFFFFF',
                        border: (vehicleInSlot.primer_lap_count || 0) >= 1 ? 'none' : '1.5px solid #555',
                      }}
                    />
                  )}
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