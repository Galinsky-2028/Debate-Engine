import type {Pool} from "pg";
export function runDeadlineJobs(pool: Pool, limit?: number): Promise<number>;
export function runBatch(pool?: Pool): Promise<number>;
