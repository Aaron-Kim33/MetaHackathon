import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { MotionCalibration } from './spatial-motion';
export function useSpatialMotion(enabled: boolean, calibration: number) {
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const recenter = useRef<() => void>(() => {});
  useEffect(() => {
    setPoint({ x: 0, y: 0 });
    let disposed = false, generation = 0, subscription: ReturnType<typeof DeviceMotion.addListener> | undefined;
    let tracker = new MotionCalibration();
    recenter.current = () => setPoint(tracker.recenter());
    const stop = () => { generation++; subscription?.remove(); subscription = undefined; tracker = new MotionCalibration(); if (!disposed) setPoint({ x: 0, y: 0 }); };
    const start = async () => {
      const requested = ++generation;
      if (!enabled || disposed || AppState.currentState !== 'active') return;
      if (await AccessibilityInfo.isReduceMotionEnabled()) return;
      if (!(await DeviceMotion.isAvailableAsync()) || !(await DeviceMotion.getPermissionsAsync()).granted || disposed || requested !== generation || AppState.currentState !== 'active') return;
      DeviceMotion.setUpdateInterval(50);
      subscription?.remove();
      subscription = DeviceMotion.addListener(sample => {
        if (disposed || !sample.rotation) return;
        setPoint(tracker.sample(sample.rotation));
      });
    };
    void start().catch(() => {});
    const state = AppState.addEventListener('change', next => { stop(); if (next === 'active') void start().catch(() => {}); });
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => { stop(); if (!reduced) void start().catch(() => {}); });
    return () => { disposed = true; recenter.current = () => {}; stop(); state.remove(); accessibility.remove(); };
  }, [enabled]);
  useEffect(() => { recenter.current(); }, [calibration]);
  return enabled ? point : { x: 0, y: 0 };
}
