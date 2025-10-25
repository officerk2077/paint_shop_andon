import React, { useEffect, useState } from 'react';
import '../assets/ToastNotification.css';

const ToastNotification = ({ id, message, type, onClose }) => { 
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        const handleAutoClose = () => {
            setExiting(true);
            setTimeout(() => onClose(id), 500); 
        };

        const timer = setTimeout(handleAutoClose, 5000);

        return () => clearTimeout(timer);
    }, [id, onClose]);

    const handleManualClose = () => {
        setExiting(true);
        setTimeout(() => onClose(id), 500); 
    };

    const icons = { success: '✅', error: '⚠️' };

    return (
        <div className={`toast ${type} ${exiting ? 'exit' : ''}`}>
            <span className="toast-icon">{icons[type] || 'ℹ️'}</span>
            <p className="toast-message">{message}</p>
            <button className="toast-close-btn" onClick={handleManualClose}>×</button>
        </div>
    );
};

export default ToastNotification;