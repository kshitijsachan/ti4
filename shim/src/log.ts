const level = process.env.SHIM_LOG ?? "info";
const rank: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const on = (l: string) => rank[l] >= (rank[level] ?? 1);
const ts = () => new Date().toISOString().slice(11, 23);

export const log = {
  debug: (m: string) => on("debug") && console.log(`${ts()} DEBUG ${m}`),
  info: (m: string) => on("info") && console.log(`${ts()} INFO  ${m}`),
  warn: (m: string) => on("warn") && console.warn(`${ts()} WARN  ${m}`),
  error: (m: string) => on("error") && console.error(`${ts()} ERROR ${m}`),
};
