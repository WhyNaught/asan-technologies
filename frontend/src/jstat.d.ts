declare module 'jstat' {
  const jStat: { studentt: { cdf(x: number, df: number): number; inv(p: number, df: number): number }; normal: { cdf(x: number, mean: number, sd: number): number } };
  export default jStat;
}
