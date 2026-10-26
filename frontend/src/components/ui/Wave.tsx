/** Small bar waveform used on recording and speaking states. */
export function Wave({ heights, live = false }: { heights: number[]; live?: boolean }) {
  return (
    <span className={`wave${live ? " live" : ""}`} aria-hidden="true">
      {heights.map((h, i) => <i key={i} style={{ height: h }} />)}
    </span>
  );
}
