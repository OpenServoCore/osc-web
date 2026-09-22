import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export type ChartOptions = Omit<uPlot.Options, "width" | "height">;

/** One uPlot filling its host; recreated when `options` changes, resized with the host. */
export function Chart({
  options,
  data,
  className,
}: {
  options: ChartOptions;
  data: uPlot.AlignedData;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const blank: uPlot.AlignedData = [[], ...options.series.slice(1).map(() => [])];
    const u = new uPlot({ ...options, width: el.clientWidth, height: el.clientHeight }, blank, el);
    chart.current = u;
    const observer = new ResizeObserver(() => {
      u.setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      u.destroy();
      chart.current = null;
    };
  }, [options]);

  useEffect(() => {
    chart.current?.setData(data);
  }, [data, options]);

  return <div ref={host} className={className} />;
}
