export type BicepParamValue = string | number | boolean;
export interface BicepParamParseResult {
    params: Record<string, BicepParamValue>;
    errors: string[];
}
export declare function parseBicepParamFile(contents: string): BicepParamParseResult;
//# sourceMappingURL=bicepParams.d.ts.map