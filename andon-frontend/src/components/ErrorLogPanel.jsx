
import React, { useState, useEffect, useRef } from 'react';
import '../assets/LogPanel.css'; // Dùng chung CSS với LogPanel

const formatTimestamp = (isoString) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return date.toLocaleTimeString('vi-VN', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    } catch (error) {
        console.error("Error formatting timestamp:", error);
        return 'Invalid Date';
    }
};

const ErrorLogPanel = ({ socket }) => {
    const [errorLogs, setErrorLogs] = useState([]);
    const logContainerRef = useRef(null);

    // Fetch logs ban đầu TỪ API MỚI
    useEffect(() => {
        const fetchErrorLogs = async () => {
            try {
                // THAY ĐỔI: Gọi API /api/error-logs
                const response = await fetch('http://localhost:3001/api/error-logs');
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.statusText}`);
                }
                const initialLogs = await response.json();
                 if (Array.isArray(initialLogs)) {
                    setErrorLogs(initialLogs);
                 } else {
                     console.error("Fetched initial error logs is not an array:", initialLogs);
                     setErrorLogs([]);
                 }
            } catch (error) {
                console.error('Lỗi khi fetch error logs ban đầu:', error);
                setErrorLogs([]);
            }
        };
        fetchErrorLogs();
    }, []);

    // Lắng nghe log mới TỪ SỰ KIỆN MỚI
    useEffect(() => {
         if (!socket) {
             console.warn("ErrorLogPanel: Socket prop is missing.");
             return;
         }

        // THAY ĐỔI: Lắng nghe sự kiện 'new-error-log'
        const handleNewErrorLog = (newLog) => {
            if (newLog && typeof newLog === 'object' && newLog.id) {
                 setErrorLogs(prevLogs => [newLog, ...prevLogs].slice(0, 100));
            } else {
                 console.warn("Received invalid error log data:", newLog);
            }
        };

        socket.on('new-error-log', handleNewErrorLog);

        return () => {
            socket.off('new-error-log', handleNewErrorLog);
        };
    }, [socket]);

    // Tự động cuộn (giữ nguyên)
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = 0;
        }
    }, [errorLogs]);

    return (
        <div className='log-panel'>
            {/* THAY ĐỔI: Tiêu đề */}
            <h4>Lịch sử lỗi (OK/NG)</h4>
            <div className='log-container' ref={logContainerRef}>
                {errorLogs.length === 0 ? (
                    <p className='empty-log'>Chưa có lỗi nào được ghi nhận.</p>
                ) : (
                    // THAY ĐỔI: Cấu trúc hiển thị
                    errorLogs.map((log) => (
                        log ? (
                             <div key={log.id} className={`log-entry log-type-${log.decision === 'NG (Sơn lại)' ? 'error' : 'success'}`}>
                                <span className='log-timestamp'>[{formatTimestamp(log.timestamp)}]</span>
                                <span className='log-message'>
                                    <strong>[{log.decision}]</strong> Xe <strong>{log.body_id}</strong> ({log.model_name})
                                    <br />
                                    <span style={{ paddingLeft: '10px', fontStyle: 'italic' }}>
                                        Tại: {log.station_name} - Lỗi: {log.error_description}
                                    </span>
                                </span>
                            </div>
                         ) : null
                    ))
                )}
            </div>
        </div>
    );
};

export default ErrorLogPanel;