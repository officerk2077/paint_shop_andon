// File: AddVehicleModal.jsx
// NỘI DUNG CẬP NHẬT HOÀN CHỈNH

import React from 'react';
import '../assets/AddVehicleModal.css'; // Sẽ trỏ đến file CSS mới bên dưới


export default function AddVehicleModal({ 
    newBodyId, 
    setNewBodyId, 
    onAddVehicle, 
    onClose,
    keepOpen,
    setKeepOpen
 }) {
    
    const handleContentClick = (e) => e.stopPropagation();

    return (
        <div className='modal-overlay' onClick={onClose}>
            {/* THAY ĐỔI: Dùng class .modal-content-dark */}
            <div className='modal-content modal-content-dark' onClick={handleContentClick}> 
                
                {/* === THAY ĐỔI: Cập nhật cấu trúc HTML của nút close === */}
                <button className='close-button' onClick={onClose}>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </button>
                {/* === KẾT THÚC THAY ĐỔI === */}
                
                <h2>Thêm xe mới vào dây chuyền</h2>

                <form onSubmit={onAddVehicle} className='add-vehicle-modal-form'>
                    <label htmlFor="bodyIdInput">Mã thân xe: </label>
                    <input
                        id='bodyIdInput' 
                        type="text"
                        value={newBodyId}
                        onChange={(e) => setNewBodyId(e.target.value)}
                        placeholder='Nhập mã thân xe '
                        autoFocus 
                        />
                    <div className='add-vehicle-modal-toggle'>
                        <input
                            type="checkbox"
                            id="keepOpenCheckBox"
                            checked={keepOpen}
                            onChange={(e) => setKeepOpen(e.target.checked)}
                        />
                        <label htmlFor="keepOpenCheckBox">
                            Thêm nhiều xe
                        </label>
                    </div>
                        <button type='submit'>Thêm xe</button>
                </form>
            </div>
        </div>
    );
};