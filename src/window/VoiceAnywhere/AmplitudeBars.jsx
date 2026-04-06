import React, { useRef, useEffect } from 'react';

const NUM_BARS = 5;
// Per-bar jitter seeds so bars look independent
const JITTER_SEEDS = [0.7, 0.4, 1.0, 0.5, 0.8];

/**
 * Five animated frequency bars driven by `amplitude` (0–1).
 * When `active` is false the bars render as short static stubs.
 */
export default function AmplitudeBars({ amplitude, active }) {
    const barsRef = useRef([]);
    const animFrameRef = useRef(null);
    const timeRef = useRef(0);
    const ampRef = useRef(amplitude);

    // Keep ref in sync without restarting the animation loop
    useEffect(() => {
        ampRef.current = amplitude;
    }, [amplitude]);

    useEffect(() => {
        let running = true;

        function tick(ts) {
            if (!running) return;
            timeRef.current = ts;
            const amp = ampRef.current;

            barsRef.current.forEach((bar, i) => {
                if (!bar) return;
                if (!active) {
                    bar.style.height = '6px';
                    bar.style.opacity = '0.4';
                    return;
                }
                // Each bar oscillates at a slightly different frequency
                const freq = 3 + i * 0.7;
                const wave = (Math.sin(ts / 1000 * freq * Math.PI) + 1) / 2; // 0–1
                const jitter = JITTER_SEEDS[i];
                const minH = 6;
                const maxH = 32;
                const height = minH + (maxH - minH) * amp * (wave * 0.6 + jitter * 0.4);
                bar.style.height = `${Math.max(minH, height)}px`;
                bar.style.opacity = '1';
            });

            animFrameRef.current = requestAnimationFrame(tick);
        }

        animFrameRef.current = requestAnimationFrame(tick);

        return () => {
            running = false;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [active]);

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                height: '36px',
            }}
        >
            {Array.from({ length: NUM_BARS }).map((_, i) => (
                <div
                    key={i}
                    ref={(el) => { barsRef.current[i] = el; }}
                    style={{
                        width: '4px',
                        borderRadius: '2px',
                        backgroundColor: 'rgba(255,255,255,0.9)',
                        transition: 'height 60ms ease, opacity 120ms ease',
                        height: '6px',
                    }}
                />
            ))}
        </div>
    );
}
