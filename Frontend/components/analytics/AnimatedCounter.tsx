/**
 * AnimatedCounter.tsx
 * Smoothly counts up from previous value → new value over ~700ms.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';

interface Props {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
}

export const AnimatedCounter: React.FC<Props> = ({
  value,
  duration = 700,
  format = (n) => Math.round(n).toLocaleString(),
  style,
}) => {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <Text style={style}>{format(display)}</Text>;
};
