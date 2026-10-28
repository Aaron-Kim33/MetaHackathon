import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { MotionCalibration } from './spatial-motion';
export type MotionStatus = 'off' | 'waiting' | 'active' | 'denied' | 'unavailable' | 'reduced' | 'error';
export function useSpatialMotion(enabled: boolean, calibration: number) {
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState<MotionStatus>('off');
  const recenter = useRef<() => void>(() => {});
  useEffect(() => {
    setPoint({ x: 0, y: 0 });
    setStatus(enabled ? 'waiting' : 'off');
    let disposed = false, generation = 0, subscription: ReturnType<typeof DeviceMotion.addListener> | undefined;
    let tracker = new MotionCalibration();
    recenter.current = () => setPoint(tracker.recenter());
    const stop = () => { generation++; subscription?.remove(); subscription = undefined; tracker = new MotionCalibration(); if (!disposed) setPoint({ x: 0, y: 0 }); };
    const start = async () => {
      const requested = ++generation;
      if (!enabled || disposed || AppState.currentState !== 'active') return;
      const reduced = await AccessibilityInfo.isReduceMotionEnabled();
      if (disposed || requested !== generation) return;
      if (reduced) { setStatus('reduced'); return; }
      const available = await DeviceMotion.isAvailableAsync();
      if (disposed || requested !== generation) return;
      if (!available) { setStatus('unavailable'); return; }
      const permission = await DeviceMotion.getPermissionsAsync();
      if (disposed || requested !== generation || AppState.currentState !== 'active') return;
      if (!permission.granted) { setStatus('denied'); return; }
      setStatus('waiting');
      DeviceMotion.setUpdateInterval(50);
      subscription?.remove();
      subscription = DeviceMotion.addListener(sample => {
        if (disposed || !sample.rotation || ![sample.rotation.beta, sample.rotation.gamma].every(Number.isFinite)) return;
        setStatus('active');
        setPoint(tracker.sample(sample.rotation));
      });
    };
    const failed = () => { if (!disposed) setStatus('error'); };
    void start().catch(failed);
    const state = AppState.addEventListener('change', next => { stop(); if (next === 'active') void start().catch(failed); });
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => { stop(); if (reduced) setStatus('reduced'); else void start().catch(failed); });
    return () => { disposed = true; recenter.current = () => {}; stop(); state.remove(); accessibility.remove(); };
  }, [enabled]);
  useEffect(() => { recenter.current(); }, [calibration]);
  return enabled ? { ...point, status } : { x: 0, y: 0, status: 'off' as MotionStatus };
}
