import { useState, useEffect } from 'react';

// Hằng số này BẮT BUỘC phải khớp với MOVE_INTERVAL ở backend
const CYCLE_DURATION = 10000; // 10 giây

export const useCountdown = (lastUpdateTime) => {
    const [timeLeft, setTimeLeft] = useState(CYCLE_DURATION / 1000);

    useEffect(() => {
        const intervalId = setInterval(() => {
            const elapsedTime = Date.now() - lastUpdateTime;
            const remainingTime = Math.max(0, CYCLE_DURATION - elapsedTime);
            setTimeLeft(remainingTime / 1000);
        }, 100);

        return () => clearInterval(intervalId);

    }, [lastUpdateTime]);

    return timeLeft;
};  