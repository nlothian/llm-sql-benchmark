export interface SamplingParams {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  presence_penalty: number;
  repetition_penalty: number;
  maxTokens: number;
}

export const DEFAULT_SAMPLING_PARAMS: SamplingParams = {
  temperature: 1.0,
  top_p: 0.95,
  top_k: 20,
  min_p: 0,
  presence_penalty: 0.0,
  repetition_penalty: 1.0,
  maxTokens: 4048,
};
