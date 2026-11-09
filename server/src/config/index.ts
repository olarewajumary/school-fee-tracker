import "dotenv/config";
import { parseEnv } from "./env";

export const config = parseEnv(process.env);
