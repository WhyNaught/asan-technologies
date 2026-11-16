// SI was at least partially used to write the code in this file
declare module 'jstat' {
  const jStat: { studentt: { cdf(x: number, df: number): number; inv(p: number, df: number): number }; normal: { cdf(x: number, mean: number, sd: number): number }; centralF: { cdf(x: number, df1: number, df2: number): number } };
  export default jStat;
}
