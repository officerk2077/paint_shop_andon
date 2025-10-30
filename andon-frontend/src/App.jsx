import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import StationBox from './components/StationBox';
import StationModal from './components/StationModal';
import AddVehicleModal from './components/AddVehicleModal';
import ToastNotification from './components/ToastNotification';
import LogPanel from './components/LogPanel';
import { FaBell, FaPause, FaPlay, FaCog, FaPlus, FaCheck, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import './assets/DashboardLayout.css';
import './assets/ToastNotification.css';

const socket = io('http://localhost:3001');

function App() {
    const [stations, setStations] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [currentTime, setCurrentTime] = useState('--:--:--');
    const [dbStatus, setDbStatus] = useState('connecting');
    const [selectedStation, setSelectedStation] = useState(null);
    const [newBodyId, setNewBodyId] = useState('');
    const [notifications, setNotifications] = useState([]);
    const [hasUnreadLogs, setHasUnreadLogs] = useState(false);
    const [showLogPanel, setShowLogPanel] = useState(false);
    const [isLinePaused, setIsLinePaused] = useState(false);

    const [showActionMenu, setShowActionMenu] = useState(false);
    const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
    const logDropdownRef = useRef(null);
    const actionMenuRef = useRef(null);

    const [keepModalOpen, setKeepModalOpen] = useState(false);

    const bufferVehicleCount = React.useMemo(() => {
        if (!Array.isArray(vehicles)) return 0;
        return vehicles.filter(v => v.current_station_id === 0).length;
    }, [vehicles]);

    const addNotification = useCallback((message, type) => {
        const id = Date.now() + Math.random();
        setNotifications(prev => [...prev, { id, message, type }]);
    }, []);

    const removeNotification = useCallback((id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const handleConfirmError = useCallback((bodyIdToConfirm, errorDescription) => { // Chấp nhận errorDescription
    console.log(`[App] Gửi yêu cầu xác nhận lỗi xe: ${bodyIdToConfirm} với lỗi "${errorDescription}"`);
    // Gửi đi payload object
    socket.emit('confirm-vehicle-error', { bodyId: bodyIdToConfirm, errorDescription: errorDescription });
    }, []);

    const handleSendToRecoat = useCallback((bodyIdToSend, errorDescription) => { // Chấp nhận errorDescription
    console.log(`[App] Gửi yêu cầu gửi xe đi WR: ${bodyIdToSend} với lỗi "${errorDescription}"`);
    // Gửi đi payload object
    socket.emit('send-to-recoat', { bodyId: bodyIdToSend, errorDescription: errorDescription });
    }, []);
    
    // Effect chính lắng nghe socket events
    useEffect(() => {
        socket.on('initial-state', (data) => {
            setStations(data.stations || []);
            setVehicles(data.vehicles || []);
        });
        socket.on('state-update', (newState) => {
            setStations(newState.stations || []);
            setVehicles(newState.vehicles || []);
        });
        socket.on('time-update', setCurrentTime);
        socket.on('db-status-update', setDbStatus);
        socket.on('operational-error', (data) => addNotification(data.message, 'error'));
        socket.on('action-confirmed', (data) => addNotification(data.message, data.type));
        socket.on('add-vehicle-error', (data) => addNotification(data.message, 'error'));

        // Lắng nghe cảnh báo rework từ server
        socket.on('vehicle-rework-alert', (data) => {
            addNotification(data.message, data.type);
        });

        socket.on('vehicle-completed', (data) => {
            addNotification(data.message, data.type);
        });

        socket.on('vehicle-checkpoint', (data) => {
            addNotification(data.message, data.type);
        });

        const handleNewLogForDot = () => {
            setShowLogPanel(currentShowState => {
                if (!currentShowState) {
                    setHasUnreadLogs(true); 
                }
                return currentShowState;
            });
        };
        socket.on('new-log', handleNewLogForDot);
        socket.on('line-status-update', (status) => {
            setIsLinePaused(status === 'paused');
        });

        const handleClickOutside = (event) => {
            const bellButton = document.querySelector('.log-toggle-btn');
            if (logDropdownRef.current && !logDropdownRef.current.contains(event.target) &&
                bellButton && !bellButton.contains(event.target))
            {
                setShowLogPanel(false); 
            }
        };

        if (showLogPanel) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        // Cleanup function
        return () => {
            socket.off('initial-state');
            socket.off('state-update');
            socket.off('time-update');
            socket.off('db-status-update');
            socket.off('operational-error');
            socket.off('action-confirmed');
            socket.off('add-vehicle-error');
            socket.off('vehicle-rework-alert');
            socket.off('vehicle-completed');
            socket.off('vehicle-checkpoint');
            socket.off('line-status-update');
            socket.off('new-log', handleNewLogForDot);
            document.removeEventListener('mousedown', handleClickOutside); 
        };
    }, [showLogPanel, addNotification])

    useEffect(() => {
        const handleClickOutsideAction = (event) => {
            const actionButton = document.querySelector('.action-menu-btn');
            if (actionMenuRef.current && !actionMenuRef.current.contains(event.target) && actionButton && !actionButton.contains(event.target))
            {
                setShowActionMenu(false);
            }
        };
        if (showActionMenu) {
            document.addEventListener('mousedown', handleClickOutsideAction);
        } else {    
            document.removeEventListener('mousedown', handleClickOutsideAction);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutsideAction);
        };
    }, [showActionMenu]);

    const handleTogglePausePlay = () => {
        const eventName = isLinePaused ? 'play-line' : 'pause-line';
        socket.emit(eventName);
    }
    const getVehiclesAtStation = useCallback((stationId) => {
        if (!Array.isArray(vehicles)) return [];
        return vehicles
            .filter(v => v.current_station_id === stationId)
            .sort((a, b) => a.slot_position - b.slot_position);
    }, [vehicles]); 

    const handleAddVehicle = (e) => {
        e.preventDefault();
        if (newBodyId.trim()) {
            socket.emit('add-vehicle', newBodyId.trim().toUpperCase());
            addNotification(`Yêu cầu thêm xe "${newBodyId.trim().toUpperCase()}" đã được gửi.`, 'success');
            setNewBodyId('');
            if (!keepModalOpen) {
                setShowAddVehicleModal(false);
            }
        }
    };

    const handleEmergencyStop = () => {
        if (window.confirm('BẠN CÓ CHẮC CHẮN MUỐN DỪNG DÂY CHUYỀN VÀ XÓA TẤT CẢ XE KHÔNG?')) {
            socket.emit('emergency-stop');
        }
    };

    const handleReportError = (stationId) => {
        socket.emit('report-operational-error', stationId);
        handleCloseModal();
    };

    const handleRemoveVehicle = useCallback((bodyIdToRemove) => {
        console.log(`[App] Gửi yêu cầu xóa xe: ${bodyIdToRemove}`);
        socket.emit('remove-vehicle', bodyIdToRemove);
        handleCloseModal(); 
    }, []); 

    const handleStationClick = (station) => setSelectedStation(station);
    const handleCloseModal = () => setSelectedStation(null);

    const getStationGridClass = (stationName) => {
        if (!stationName) return '';
        const formattedName = stationName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return `station-${formattedName}`;
    }

    const toggleLogPanel = () => {
        if (!showLogPanel) {
            setHasUnreadLogs(false); 
        }
        setShowActionMenu(false);
        setShowLogPanel(prevShow => !prevShow);
    };

    const toggleActionMenu = () => {
        setShowLogPanel(false);
        setShowActionMenu(prevShow => !prevShow);
    };

    return (
        <div className="app-container">
            <header className="app-header">
                <h1>Body Tracking - Paint Shop</h1>
                <div className="header-right">
                    <div className='header-stat'>
                        <span>Chờ vào chuyền: </span>
                        <span className='buffer-count'>{bufferVehicleCount}</span>
                    </div>
                    <a>|</a>
                    {/* new */}
                    <div className='action-menu-wrapper'>
                        <button onClick={toggleActionMenu} className='action-menu-btn' title='Hành động'>
                            <FaCog/>
                        </button>
                        {showActionMenu && (
                            <div className='action-menu-dropdown' ref={actionMenuRef}>
                                <ul>
                                    <li onClick={() => { setShowAddVehicleModal(true);
                                    setShowActionMenu(false); }}>
                                        {/* Sửa lỗi: Bọc nội dung trong thẻ span */}
                                        <span>
                                            <FaPlus/> Thêm xe...
                                        </span>
                                    </li>
                                    <li onClick={() => { handleTogglePausePlay();
                                    setShowActionMenu(false); }}>
                                        {/* Sửa lỗi: Bọc nội dung trong thẻ span */}
                                        <span>
                                            {isLinePaused ? <><FaPlay/> Tiếp tục chuyền</> : <><FaPause/> Tạm dừng chuyền</>}
                                        </span>
                                    </li>
                                    <li onClick={() => { handleEmergencyStop(); setShowActionMenu(false); }} className='action-menu-item-danger'>
                                        {/* Sửa lỗi: Bọc nội dung trong thẻ span */}
                                        <span>
                                            <FaExclamationTriangle /> Dừng khẩn cấp...
                                        </span>
                                    </li>
                                </ul>
                            </div>
                        )}
                    </div>
                    <div className="notification-bell-wrapper">
                        <button onClick={toggleLogPanel} className="log-toggle-btn" title="Xem thông báo">
                            <FaBell />
                            {hasUnreadLogs && <span className="log-badge-dot"></span>}
                        </button>
                        {showLogPanel && (
                            <div className="log-panel-dropdown" ref={logDropdownRef}> 
                                <LogPanel socket={socket} />
                            </div>
                        )}
                    </div>
                    <a>|</a>
                    <div className="system-time">{currentTime}</div>
                </div>
            </header>

            <div className="dashboard-scroll-container">
                <div className="dashboard-grid">
                    {stations.map(station => (
                        <div key={station.id} className={getStationGridClass(station.name)}>
                            <StationBox
                                station={station}
                                vehicles={getVehiclesAtStation(station.id)} 
                                onClick={() => handleStationClick(station)}
                            />
                        </div>
                    ))}
                </div>
            </div>
            
            <footer className={`app-footer status-${dbStatus}`}>
                <div className="status-indicator"></div>
                <span>Server: {dbStatus === 'connected' ? 'Connected' : 'Disconnected'}</span>
            </footer>

            {selectedStation && (
                <StationModal
                    station={selectedStation}
                    vehicles={getVehiclesAtStation(selectedStation.id)}
                    onClose={handleCloseModal}
                    onReportError={handleReportError}
                    onRemoveVehicle={handleRemoveVehicle}
                    onConfirmError={handleConfirmError}
                    onSendToRecoat={handleSendToRecoat}
                />
            )}

            {showAddVehicleModal && (
                <AddVehicleModal
                    newBodyId={newBodyId}
                    setNewBodyId={setNewBodyId}
                    onAddVehicle={handleAddVehicle}
                    onClose={() => setShowAddVehicleModal(false)}
                    keepOpen={keepModalOpen}
                    setKeepOpen={setKeepModalOpen}
                />
            )}

            <div className="toast-container">
                {notifications.map(n => (
                    <ToastNotification key={n.id} {...n} onClose={removeNotification} />
                ))}
            </div>
        </div>
    );
}

export default App;