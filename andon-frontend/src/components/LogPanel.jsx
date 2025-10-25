import React, { useState, useEffect, useRef } from 'react';
import '../assets/LogPanel.css';

const formatTimestamp = (isoString) => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) {
            return 'Invalid Date';
        }
        return date.toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch (error) {
        console.error("Error formatting timestamp:", error);
        return 'Invalid Date';
    }
};

const LogPanel = ({ socket }) => {
    const [logs, setLogs] = useState([]);
    const logContainerRef = useRef(null);

    // Fetch logs ban đầu
    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const response = await fetch('http://localhost:3001/api/logs');
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.statusText}`);
                }
                const initialLogs = await response.json();
                 if (Array.isArray(initialLogs)) {
                    setLogs(initialLogs);
                 } else {
                     console.error("Fetched initial logs is not an array:", initialLogs);
                     setLogs([]);
                 }
            } catch (error) {
                console.error('Lỗi khi fetch logs ban đầu:', error);
                setLogs([]);
            }
        };
        fetchLogs();
    }, []);

    // Lắng nghe log mới
    useEffect(() => {
         if (!socket) {
             console.warn("LogPanel: Socket prop is missing.");
             return;
         }

        const handleNewLog = (newLog) => {
            if (newLog && typeof newLog === 'object' && newLog.id && newLog.message) {
                 setLogs(prevLogs => [newLog, ...prevLogs].slice(0, 100));
            } else {
                 console.warn("Received invalid log data:", newLog);
            }
        };

        socket.on('new-log', handleNewLog);

        return () => {
            socket.off('new-log', handleNewLog);
        };
    }, [socket]);

    // Tự động cuộn
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = 0;
        }
    }, [logs]);

    return (
        <div className='log-panel'>
            <h4>Thông báo hệ thống</h4>
            <div className='log-container' ref={logContainerRef}>
                {logs.length === 0 ? (
                    <p className='empty-log'>Chưa có thông báo nào.</p>
                ) : (
                    logs.map((log) => (
                        log ? (
                             <div key={log.id || Math.random()} className={`log-entry log-type-${log.type || 'info'}`}>
                                <span className='log-timestamp'>[{formatTimestamp(log.timestamp)}]</span>
                                <span className='log-message'>{log.message || 'No message'}</span>
                            </div>
                         ) : null
                    ))
                )}
            </div>
        </div>
    );
};

export default LogPanel;