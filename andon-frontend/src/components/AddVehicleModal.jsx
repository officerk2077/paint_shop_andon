import React from 'react';
import '../assets/AddVehicleModal.css';


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
            <div className='modal-content' onClick={handleContentClick}> 
                <button className='close-button' onClick={onClose}>x</button>
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
                        <label htmlFor="keepOpenCheckbox">
                            Thêm nhiều xe
                        </label>
                    </div>
                        <button type='submit'>Thêm xe</button>
                </form>
            </div>
        </div>
    );
};