export type AiStatus =
  | { status: 'idle' }
  | { status: 'processing'; task: string }
  | { status: 'completed'; result: string }
  | { status: 'failed'; error: string }
